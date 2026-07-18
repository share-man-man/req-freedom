import { defineContentScript } from 'wxt/utils/define-content-script';
import type { InsertScriptRule, Rule } from '@req-freedom/shared';
import {
  DEFAULT_MOCK_CONTENT_TYPE,
  InsertScriptCodeType,
  InsertScriptTiming,
  PAGE_MESSAGE_SOURCE,
  RuleType,
} from '@req-freedom/shared';
import { filterRulesByType, findMatchedRules, pickRuleByType, sleep } from '@req-freedom/core';

/**
 * 拦截内容脚本（MAIN world）
 *
 * 在页面自身的 JS 环境中给 fetch / XMLHttpRequest 打补丁，
 * 实现 DNR 无法覆盖的两类能力：返回值 Mock、延迟模拟。
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

    // ---------- fetch 补丁 ----------

    /** 页面原始 fetch，补丁未命中时回落使用 */
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      /** 请求 URL（统一为字符串） */
      const url = toAbsoluteUrl(
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      );
      const { mockRule, delayRule } = resolvePageRules(url);

      // 关键步骤：先执行延迟规则
      if (delayRule) {
        await sleep(delayRule.delayMs);
      }

      // 关键步骤：命中 Mock 时直接构造响应，不发起真实请求
      if (mockRule) {
        await sleep(mockRule.delayMs ?? 0);
        return new Response(mockRule.body, {
          status: mockRule.statusCode,
          headers: {
            'Content-Type': DEFAULT_MOCK_CONTENT_TYPE,
            ...mockRule.responseHeaders,
          },
        });
      }

      return originalFetch(input, init);
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
      /** 延迟规则与 Mock 自带延迟的总时长 */
      const totalDelayMs = (delayRule?.delayMs ?? 0) + (mockRule?.delayMs ?? 0);

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
