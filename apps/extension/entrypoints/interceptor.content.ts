import { defineContentScript } from 'wxt/utils/define-content-script';
import type { DelayRule, InsertScriptRule, Rule } from '@req-freedom/shared';
import {
  DEFAULT_MOCK_CONTENT_TYPE,
  InsertScriptCodeType,
  InsertScriptTiming,
  PAGE_MESSAGE_SOURCE,
  RuleType,
} from '@req-freedom/shared';
import {
  filterRulesByType,
  findMatchedRules,
  getNetworkRequestDelayMs,
  getNetworkThrottleSettings,
  getTransferDurationMs,
  pickRuleByType,
  sleep,
} from '@req-freedom/core';

/**
 * 拦截内容脚本（MAIN world）
 *
 * 在页面自身的 JS 环境中给 fetch / XMLHttpRequest 打补丁，
 * 实现 DNR 无法覆盖的两类能力：返回值 Mock、网络限速模拟。
 * 规则由 bridge.content.ts 通过 postMessage 推送。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    /** 页面内规则状态（由桥接脚本异步推送，推送到达前为空） */
    const state = { enabled: true, rules: [] as Rule[] };

    /** 已注入的 InsertScript 规则 ID，防止 storage 变更重推时重复注入 */
    const injectedRuleIds = new Set<string>();

    // 监听桥接脚本推送的规则更新
    window.addEventListener('message', (event: MessageEvent) => {
      // 只接受同窗口、带指定来源标识的消息
      if (event.source !== window || event.data?.source !== PAGE_MESSAGE_SOURCE) {
        return;
      }
      state.enabled = Boolean(event.data.enabled);
      state.rules = Array.isArray(event.data.rules) ? (event.data.rules as Rule[]) : [];
      // 规则到达后按需注入命中当前页面的脚本 / 样式
      applyInsertScripts();
    });

    // ---------- InsertScript 脚本 / 样式注入 ----------

    /**
     * 把一条 InsertScript 规则的代码注入当前页面
     *
     * CSS 走 <style>，JS 走 <script>（注入后代码同步执行，随即移除标签保持 DOM 干净）。
     * document_start 阶段 document.head 可能尚未生成，回落到 documentElement。
     * @param rule 注入规则
     */
    const injectCode = (rule: InsertScriptRule): void => {
      /** 注入挂载点：优先 head，document_start 早期回落到 documentElement */
      const mount = document.head ?? document.documentElement;
      if (rule.codeType === InsertScriptCodeType.Css) {
        /** 承载样式的 style 元素 */
        const style = document.createElement('style');
        style.textContent = rule.code;
        mount.appendChild(style);
        return;
      }
      /** 承载脚本的 script 元素 */
      const script = document.createElement('script');
      script.textContent = rule.code;
      mount.appendChild(script);
      script.remove();
    };

    /**
     * 找出命中当前页面 URL 的 InsertScript 规则并按时机注入
     *
     * 每条规则每次页面加载只注入一次（injectedRuleIds 去重）；
     * document_end 且 DOM 未就绪时，延后到 DOMContentLoaded 再注入。
     */
    const applyInsertScripts = (): void => {
      if (!state.enabled) {
        return;
      }
      /** 命中当前页面 URL 的全部规则 */
      const matched = findMatchedRules(window.location.href, state.rules);
      for (const rule of filterRulesByType(matched, RuleType.InsertScript)) {
        if (injectedRuleIds.has(rule.id)) {
          continue;
        }
        // 立即标记，避免重推时重复注入或重复挂载 DOMContentLoaded 监听
        injectedRuleIds.add(rule.id);
        if (rule.timing === InsertScriptTiming.DocumentEnd && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => injectCode(rule), { once: true });
        } else {
          injectCode(rule);
        }
      }
    };

    /**
     * 找出命中 URL 的 Mock 规则与延迟规则
     * @param url 绝对化后的请求 URL
     * @returns Mock 规则与延迟规则（可能均为 undefined）
     */
    const resolvePageRules = (url: string) => {
      if (!state.enabled) {
        return { mockRule: undefined, delayRule: undefined };
      }
      /** 命中的全部规则 */
      const matched = findMatchedRules(url, state.rules);
      return {
        mockRule: pickRuleByType(matched, RuleType.MockResponse),
        delayRule: pickRuleByType(matched, RuleType.Delay),
      };
    };

    /**
     * 把相对 URL 转成绝对 URL，便于统一匹配
     * @param url 原始 URL（可能是相对路径）
     * @returns 绝对 URL；解析失败时原样返回
     */
    const toAbsoluteUrl = (url: string): string => {
      try {
        return new URL(url, window.location.href).toString();
      } catch {
        return url;
      }
    };

    /**
     * 尽可能计算请求体字节数，以便在发送前模拟上行带宽。
     * 流式请求体和 FormData 的 multipart 编码由浏览器生成，无法在不消费请求体的前提下精确获知，故回退为 0。
     * @param body 任意形式的请求体
     * @returns 可确定的请求体字节数；未知时返回 0
     */
    const getRequestBodyByteLength = (body: unknown): number => {
      if (typeof body === 'string') {
        return new TextEncoder().encode(body).byteLength;
      }
      if (body instanceof Blob) {
        return body.size;
      }
      if (body instanceof ArrayBuffer) {
        return body.byteLength;
      }
      if (ArrayBuffer.isView(body)) {
        return body.byteLength;
      }
      if (body instanceof URLSearchParams) {
        return new TextEncoder().encode(body.toString()).byteLength;
      }
      return 0;
    };

    /**
     * 获取 fetch 请求体大小。Request 输入的 body 不可重复读取，优先使用其 Content-Length 头作保守估计。
     * @param input fetch 的第一个参数
     * @param init fetch 的可选初始化参数
     * @returns 可确定的请求体字节数；未知时返回 0
     */
    const getFetchBodyByteLength = (input: RequestInfo | URL, init?: RequestInit): number => {
      if (init?.body !== undefined) {
        return getRequestBodyByteLength(init.body);
      }
      if (input instanceof Request) {
        /** 请求头中声明的请求体大小。 */
        const contentLength = Number(input.headers.get('content-length'));
        return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
      }
      return 0;
    };

    /**
     * 包装 Response 的响应流，按下行带宽逐块交付给页面代码。
     * @param response 原始响应
     * @param rule 命中的网络限速规则
     * @returns 未配置下行带宽时返回原响应，否则返回受限速的响应副本
     */
    const throttleResponse = (response: Response, rule: DelayRule | undefined): Response => {
      if (!rule || !response.body) {
        return response;
      }
      /** 命中规则实际生效的网络参数。 */
      const settings = getNetworkThrottleSettings(rule);
      if (settings.downloadKbps === 0) {
        return response;
      }
      /** 原始响应流的读取器。 */
      const reader = response.body.getReader();
      /** 用于计算累计下行耗时的开始时间。 */
      const startedAt = performance.now();
      /** 已交付给页面的累计字节数。 */
      let deliveredBytes = 0;
      /** 按带宽节奏向页面交付数据的流。 */
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          /** 从原始网络流读到的下一段数据。 */
          const result = await reader.read();
          if (result.done) {
            controller.close();
            return;
          }
          deliveredBytes += result.value.byteLength;
          /** 以累计字节数计算的目标交付时间。 */
          const targetElapsedMs = getTransferDurationMs(deliveredBytes, settings.downloadKbps);
          /** 当前交付还需等待的时长，负值代表读取本身已消耗足够时间。 */
          const waitMs = Math.max(0, targetElapsedMs - (performance.now() - startedAt));
          await sleep(waitMs);
          controller.enqueue(result.value);
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      });
      /** 保留原响应元数据的受限速响应。 */
      const throttledResponse = new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      // Response 构造器无法接收 url / type / redirected；显式覆盖以保持调用方可观察到的元数据不变。
      Object.defineProperties(throttledResponse, {
        url: { value: response.url },
        type: { value: response.type },
        redirected: { value: response.redirected },
      });
      return throttledResponse;
    };

    // ---------- fetch 补丁 ----------

    /** 页面原始 fetch，补丁未命中时回落使用 */
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      /** 请求 URL（统一为字符串） */
      const url = toAbsoluteUrl(
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      );
      const { mockRule, delayRule } = resolvePageRules(url);

      // 关键步骤：在请求实际发出前模拟网络往返延迟与上行传输时间
      if (delayRule) {
        /** 由请求体大小和网络档位共同计算的请求前等待时间。 */
        const requestDelayMs = getNetworkRequestDelayMs(
          delayRule,
          getFetchBodyByteLength(input, init),
        );
        await sleep(requestDelayMs);
      }

      // 关键步骤：命中 Mock 时直接构造响应，不发起真实请求
      if (mockRule) {
        await sleep(mockRule.delayMs ?? 0);
        /** 按网络限速规则交付 Mock 响应，确保 Mock 与真实请求具有一致的弱网表现。 */
        const response = new Response(mockRule.body, {
          status: mockRule.statusCode,
          headers: {
            'Content-Type': DEFAULT_MOCK_CONTENT_TYPE,
            ...mockRule.responseHeaders,
          },
        });
        return throttleResponse(response, delayRule);
      }

      /** 真实网络响应在响应流层面按下行带宽向页面交付。 */
      const response = await originalFetch(input, init);
      return throttleResponse(response, delayRule);
    };

    // ---------- XMLHttpRequest 补丁 ----------

    /** 记录每个 XHR 实例 open 时的 URL，供 send 阶段匹配规则 */
    const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();
    /** 原始 open 方法 */
    const originalOpen = XMLHttpRequest.prototype.open;
    /** 原始 send 方法 */
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function open(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      isAsync: boolean = true,
      username?: string | null,
      password?: string | null,
    ) {
      // 记录 URL，send 阶段才能拿到完整上下文
      xhrUrlMap.set(this, toAbsoluteUrl(String(url)));
      return originalOpen.call(this, method, url, isAsync, username, password);
    };

    XMLHttpRequest.prototype.send = function send(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      /** open 阶段记录的请求 URL */
      const url = xhrUrlMap.get(this) ?? '';
      const { mockRule, delayRule } = resolvePageRules(url);
      /** 延迟规则与 Mock 自带延迟的总时长。XHR 不暴露可替换的响应流，因此仅模拟请求前的网络延迟与上行带宽。 */
      const totalDelayMs =
        (delayRule ? getNetworkRequestDelayMs(delayRule, getRequestBodyByteLength(body)) : 0) +
        (mockRule?.delayMs ?? 0);

      // 关键步骤：命中 Mock 时伪造 XHR 完成态并派发事件，不发起真实请求
      if (mockRule) {
        setTimeout(() => {
          Object.defineProperty(this, 'readyState', { value: XMLHttpRequest.DONE });
          Object.defineProperty(this, 'status', { value: mockRule.statusCode });
          Object.defineProperty(this, 'responseText', { value: mockRule.body });
          Object.defineProperty(this, 'response', { value: mockRule.body });
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        }, totalDelayMs);
        return;
      }

      // 仅延迟：推迟真实 send
      if (totalDelayMs > 0) {
        setTimeout(() => originalSend.call(this, body), totalDelayMs);
        return;
      }

      return originalSend.call(this, body);
    };
  },
});
