import { defineContentScript } from 'wxt/utils/define-content-script';
import type {
  DelayAction,
  InsertScriptAction,
  MockResponseAction,
  Rule,
} from '@req-freedom/shared';
import {
  DEFAULT_MOCK_BODY_TYPE,
  DEFAULT_MOCK_CONTENT_TYPE,
  InsertScriptCodeType,
  InsertScriptTiming,
  MOCK_BODY_TYPE_CONTENT_TYPES,
  MockResponseMode,
  PAGE_MESSAGE_SOURCE,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import {
  filterActionsByType,
  filterRulesByBody,
  filterRulesByChannel,
  findMatchedRules,
  getNetworkRequestDelayMs,
  getNetworkThrottleSettings,
  getTransferDurationMs,
  modifyRequestBody,
  pickActionByType,
  rulesNeedBody,
  sleep,
} from '@req-freedom/core';

/** 动态 Mock 与动态改请求体函数可读取的请求快照。 */
interface DynamicRequestContext {
  /** 请求的绝对 URL。 */
  url: string;
  /** HTTP 方法（大写）。 */
  method: string;
  /** 页面代码在请求发出前设置的请求头。 */
  headers: Record<string, string>;
  /** URL 查询参数；同名参数保留最后一个值。 */
  query: Record<string, string>;
  /** 请求体的文本形式；无法读取的流式请求体回退为空字符串。 */
  body: string;
  /** 请求体为合法 JSON 时的解析结果。 */
  json?: unknown;
}

/** XHR 在 open / setRequestHeader 阶段收集的请求元信息。 */
interface XhrRequestMetadata {
  /** 请求的绝对 URL。 */
  url: string;
  /** open 调用传入的 HTTP 方法。 */
  method: string;
  /** setRequestHeader 调用设置的请求头。 */
  headers: Record<string, string>;
}

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
    const injectCode = (rule: InsertScriptAction): void => {
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
      const matched = filterRulesByChannel(
        findMatchedRules(window.location.href, 'GET', state.rules),
        RuleExecutionChannel.PagePatch,
      );
      for (const action of filterActionsByType(matched, RuleActionType.InsertScript)) {
        /** 注入动作唯一 ID，由规则 ID 与动作类型拼接而成。 */
        const actionId = `${matched.find((rule) => rule.actions.includes(action))?.id ?? ''}:${action.type}`;
        if (injectedRuleIds.has(actionId)) {
          continue;
        }
        // 立即标记，避免重推时重复注入或重复挂载 DOMContentLoaded 监听
        injectedRuleIds.add(actionId);
        if (action.timing === InsertScriptTiming.DocumentEnd && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => injectCode(action), { once: true });
        } else {
          injectCode(action);
        }
      }
    };

    /**
     * 按 URL + 方法 + 通道初筛命中的页面补丁规则（同步，不含请求体条件）
     *
     * 请求体条件需要读取请求体后二次过滤，成本较高，故与这一步分离：
     * 无请求体条件时可直接使用初筛结果，避免无谓地读取请求体。
     * @param url 绝对化后的请求 URL
     * @param method 请求方法
     * @returns 命中 URL + 方法的页面补丁规则列表
     */
    const resolveCandidateRules = (url: string, method: string): Rule[] => {
      if (!state.enabled) {
        return [];
      }
      return filterRulesByChannel(
        findMatchedRules(url, method, state.rules),
        RuleExecutionChannel.PagePatch,
      );
    };

    /**
     * 从（已完成请求体二次过滤的）规则集中挑出 Mock / 延迟 / 改请求体动作
     * @param rules 已命中的页面补丁规则
     * @returns Mock 规则、延迟规则与改请求体规则（可能均为 undefined）
     */
    const pickPageActions = (rules: Rule[]) => ({
      mockRule: pickActionByType(rules, RuleActionType.MockResponse),
      delayRule: pickActionByType(rules, RuleActionType.Delay),
      modifyBodyRule: pickActionByType(rules, RuleActionType.ModifyRequestBody),
    });

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
     * 读取 fetch 请求体的文本形式，供 JSON 深合并使用。
     * init.body 优先（字符串直取，其余借 Response 解码）；否则回落到 Request 输入的克隆体，避免消费原请求。
     * @param input fetch 的第一个参数
     * @param init fetch 的可选初始化参数
     * @returns 请求体文本；无法读取时返回空串
     */
    const readFetchBodyText = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<string> => {
      if (init?.body != null) {
        if (typeof init.body === 'string') {
          return init.body;
        }
        try {
          return await new Response(init.body as BodyInit).text();
        } catch {
          return '';
        }
      }
      if (input instanceof Request) {
        try {
          // 克隆后再读，保证原始 Request 的 body 不被消费
          return await input.clone().text();
        } catch {
          return '';
        }
      }
      return '';
    };

    /**
     * 读取 XHR 请求体的文本形式，供 JSON 深合并使用。
     * @param body send 收到的请求体
     * @returns 请求体文本；无法读取（如 Document）时返回空串
     */
    const readXhrBodyText = async (
      body?: Document | XMLHttpRequestBodyInit | null,
    ): Promise<string> => {
      if (body == null) {
        return '';
      }
      if (typeof body === 'string') {
        return body;
      }
      try {
        return await new Response(body as BodyInit).text();
      } catch {
        return '';
      }
    };

    /**
     * 将 Headers 转为可安全传给动态 Mock 函数的普通对象。
     * @param headers 浏览器 Headers 对象
     * @returns 小写 Header 名称与值组成的普通对象
     */
    const headersToRecord = (headers: Headers): Record<string, string> => {
      /** 动态函数可读取的请求头映射。 */
      const record: Record<string, string> = {};
      headers.forEach((value, name) => {
        record[name] = value;
      });
      return record;
    };

    /**
     * 构造传给动态函数的请求快照。
     * @param url 请求的绝对 URL
     * @param method HTTP 方法
     * @param headers 请求头映射
     * @param body 请求体文本
     * @returns 供用户函数读取的请求信息
     */
    const createDynamicRequestContext = (
      url: string,
      method: string,
      headers: Record<string, string>,
      body: string,
    ): DynamicRequestContext => {
      /** 当前 URL 的查询参数映射。 */
      const query: Record<string, string> = {};
      try {
        /** 解析后的请求 URL。 */
        const parsedUrl = new URL(url, window.location.href);
        parsedUrl.searchParams.forEach((value, name) => {
          query[name] = value;
        });
      } catch {
        // URL 已在匹配前绝对化；这里仅防御性回退为空查询参数。
      }
      /** 当请求体为合法 JSON 时供用户函数直接使用的解析值。 */
      let json: unknown;
      try {
        json = body ? JSON.parse(body) : undefined;
      } catch {
        // 非 JSON 请求体是正常情况，仍通过 body 原文提供给用户函数。
      }
      return {
        url,
        method: method.toUpperCase(),
        headers,
        query,
        body,
        ...(json === undefined ? {} : { json }),
      };
    };

    /**
     * 运行动态 Mock 函数并将返回值转换为响应体文本。
     *
     * 用户代码刻意在 MAIN world 执行，以便拥有与页面脚本一致的上下文；只应执行用户信任的代码。
     * @param rule 命中的动态 Mock 规则
     * @param request 传入用户代码的请求快照
     * @returns 字符串响应体；对象与其他 JSON 值会自动序列化
     */
    const executeDynamicMock = async (
      rule: MockResponseAction,
      request: DynamicRequestContext,
    ): Promise<string> => {
      try {
        // 用户代码是一个完整函数（如 function mock(req){...}）；括号包成函数表达式后立即以 req 调用，兼容普通与 async 函数
        const execute = new Function(
          'req',
          `"use strict"; return (\n${rule.functionCode ?? ''}\n)(req);`,
        ) as (req: DynamicRequestContext) => Promise<unknown>;
        /** 用户函数返回的原始值。 */
        const result = await execute(request);
        if (typeof result === 'string') {
          return result;
        }
        /** JSON.stringify(undefined) 会返回 undefined，响应体应稳定回退为空文本。 */
        const serialized = JSON.stringify(result);
        return serialized ?? '';
      } catch (error) {
        /** 便于开发者在页面控制台定位函数执行错误。 */
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Req Freedom] 动态 Mock 函数执行失败：', error);
        return JSON.stringify({ error: 'Req Freedom dynamic mock execution failed', message });
      }
    };

    /**
     * 根据 Mock 规则生成响应体；静态模式不执行任何用户代码。
     * @param rule 命中的 Mock 规则
     * @param request 动态模式使用的请求快照
     * @returns 可直接传给 Response / XHR 的响应体文本
     */
    const resolveMockBody = async (
      rule: MockResponseAction,
      request: DynamicRequestContext,
    ): Promise<string> =>
      rule.mode === MockResponseMode.Dynamic ? executeDynamicMock(rule, request) : rule.body;

    /**
     * 执行动态改请求体函数并将返回值转换为最终请求体文本。
     *
     * 函数异常、未返回值或无法序列化时均保留原请求体，避免调试规则意外发送空请求。
     * @param functionCode 用户填写的完整 JavaScript 函数（如 function modify(req){...}）
     * @param request 传入用户代码的请求快照
     * @param originalBody 原始请求体文本
     * @returns 最终要发送的请求体文本
     */
    const executeDynamicRequestBody = async (
      functionCode: string,
      request: DynamicRequestContext,
      originalBody: string,
    ): Promise<string> => {
      try {
        // 用户代码是一个完整函数；括号包成函数表达式后立即以 req 调用，兼容普通与 async 函数
        const execute = new Function(
          'req',
          `"use strict"; return (\n${functionCode}\n)(req);`,
        ) as (req: DynamicRequestContext) => Promise<unknown>;
        /** 用户函数返回的原始值。 */
        const result = await execute(request);
        if (result === undefined) {
          return originalBody;
        }
        if (typeof result === 'string') {
          return result;
        }
        /** 对象与其他 JSON 值使用标准序列化，无法序列化时回退原请求体。 */
        const serialized = JSON.stringify(result);
        return serialized ?? originalBody;
      } catch (error) {
        console.error('[Req Freedom] 动态改请求体函数执行失败：', error);
        return originalBody;
      }
    };

    /**
     * 获取 fetch 实际会使用的 HTTP 方法。
     * @param input fetch 的第一个参数
     * @param init fetch 的可选初始化参数
     * @returns 大写 HTTP 方法
     */
    const getFetchMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
      (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    /**
     * 获取 fetch 实际会使用的请求头；init.headers 会覆盖 Request 输入中同名的请求头。
     * @param input fetch 的第一个参数
     * @param init fetch 的可选初始化参数
     * @returns 合并后的 Headers 对象
     */
    const getFetchHeaders = (input: RequestInfo | URL, init?: RequestInit): Headers => {
      /** Request 输入自带的请求头。 */
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) {
        /** init 中声明的请求头，会按 fetch 语义覆盖同名头。 */
        const initHeaders = new Headers(init.headers);
        initHeaders.forEach((value, name) => headers.set(name, value));
      }
      return headers;
    };

    /**
     * 包装 Response 的响应流，按下行带宽逐块交付给页面代码。
     * @param response 原始响应
     * @param rule 命中的网络限速规则
     * @returns 未配置下行带宽时返回原响应，否则返回受限速的响应副本
     */
    const throttleResponse = (response: Response, rule: DelayAction | undefined): Response => {
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
      /** 当前 fetch 实际使用的 HTTP 方法。 */
      const method = getFetchMethod(input, init);
      /** URL + 方法初筛命中的页面补丁规则。 */
      const candidateRules = resolveCandidateRules(url, method);
      // 含请求体匹配条件时，读取一次请求体后按条件二次过滤；否则沿用初筛结果，避免多余读取
      const activeRules = rulesNeedBody(candidateRules)
        ? filterRulesByBody(candidateRules, await readFetchBodyText(input, init))
        : candidateRules;
      const { mockRule, delayRule, modifyBodyRule } = pickPageActions(activeRules);

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
        /** 动态模式读取请求快照后生成响应；静态模式直接使用配置中的 body。 */
        const mockBody =
          mockRule.mode === MockResponseMode.Dynamic
            ? await resolveMockBody(
                mockRule,
                createDynamicRequestContext(
                  url,
                  method,
                  headersToRecord(getFetchHeaders(input, init)),
                  await readFetchBodyText(input, init),
                ),
              )
            : mockRule.body;
        /** 静态模式按响应体类型推导 Content-Type，动态模式回落到默认 JSON；显式 responseHeaders 仍可覆盖。 */
        const mockContentType =
          mockRule.mode === MockResponseMode.Static
            ? MOCK_BODY_TYPE_CONTENT_TYPES[mockRule.bodyType ?? DEFAULT_MOCK_BODY_TYPE]
            : DEFAULT_MOCK_CONTENT_TYPE;
        /** 按网络限速规则交付 Mock 响应，确保 Mock 与真实请求具有一致的弱网表现。 */
        const response = new Response(mockBody, {
          status: mockRule.statusCode,
          headers: {
            'Content-Type': mockContentType,
            ...mockRule.responseHeaders,
          },
        });
        return throttleResponse(response, delayRule);
      }

      // 关键步骤：命中改请求体规则时，在真实请求发出前改写请求体（Mock 不发真实请求，故置于其后）
      if (modifyBodyRule && method !== 'GET' && method !== 'HEAD') {
        /** 原始请求体文本；静态 Replace 无需读取，JSON 深合并与动态模式需要。 */
        const originalBody =
          modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic ||
          modifyBodyRule.mode === RequestBodyMode.MergeJson
            ? await readFetchBodyText(input, init)
            : '';
        /** 按规则改写后的最终请求体文本。 */
        const nextBody =
          modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic
            ? await executeDynamicRequestBody(
                modifyBodyRule.functionCode ?? '',
                createDynamicRequestContext(
                  url,
                  getFetchMethod(input, init),
                  headersToRecord(getFetchHeaders(input, init)),
                  originalBody,
                ),
                originalBody,
              )
            : modifyRequestBody(modifyBodyRule.mode, modifyBodyRule.content, originalBody);
        // input 为 Request 时其 method / headers 仍被保留，init.body 仅覆盖请求体
        const response = await originalFetch(input, { ...init, body: nextBody });
        return throttleResponse(response, delayRule);
      }

      /** 真实网络响应在响应流层面按下行带宽向页面交付。 */
      const response = await originalFetch(input, init);
      return throttleResponse(response, delayRule);
    };

    // ---------- XMLHttpRequest 补丁 ----------

    /** 记录每个 XHR 实例在 open / setRequestHeader 阶段的请求信息，供 send 阶段匹配与动态 Mock 使用。 */
    const xhrRequestMap = new WeakMap<XMLHttpRequest, XhrRequestMetadata>();
    /** 原始 open 方法 */
    const originalOpen = XMLHttpRequest.prototype.open;
    /** 原始 setRequestHeader 方法。 */
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
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
      // 记录 URL、方法与空请求头，send 阶段才能拿到完整上下文；重复 open 会重置此前收集的数据。
      xhrRequestMap.set(this, {
        url: toAbsoluteUrl(String(url)),
        method: method.toUpperCase(),
        headers: {},
      });
      return originalOpen.call(this, method, url, isAsync, username, password);
    };

    XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      /** 当前 XHR 的请求元信息。 */
      const request = xhrRequestMap.get(this);
      if (request) {
        // 与 XHR 原生语义一致：重复设置同名 Header 时追加逗号分隔值。
        request.headers[name.toLowerCase()] = request.headers[name.toLowerCase()]
          ? `${request.headers[name.toLowerCase()]}, ${value}`
          : value;
      }
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function send(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      /** open / setRequestHeader 阶段记录的请求上下文。 */
      const requestMetadata = xhrRequestMap.get(this);
      /** open 阶段记录的请求 URL。 */
      const url = requestMetadata?.url ?? '';
      /** open 阶段记录的请求方法。 */
      const method = requestMetadata?.method ?? 'GET';
      /** URL + 方法初筛命中的页面补丁规则。 */
      const candidateRules = resolveCandidateRules(url, method);

      /**
       * 依据（已完成请求体二次过滤的）命中规则执行 Mock / 延迟 / 改请求体 / 真实发送。
       *
       * 以箭头函数承载，`this` 仍指向当前 XHR 实例；请求体二次过滤是否发生不影响这段逻辑。
       * @param activeRules 请求体条件也已命中的规则集
       */
      const proceed = (activeRules: Rule[]): void => {
        const { mockRule, delayRule, modifyBodyRule } = pickPageActions(activeRules);
        /** 延迟规则与 Mock 自带延迟的总时长。XHR 不暴露可替换的响应流，因此仅模拟请求前的网络延迟与上行带宽。 */
        const totalDelayMs =
          (delayRule ? getNetworkRequestDelayMs(delayRule, getRequestBodyByteLength(body)) : 0) +
          (mockRule?.delayMs ?? 0);

        // 关键步骤：命中 Mock 时伪造 XHR 完成态并派发事件，不发起真实请求
        if (mockRule) {
          /** 让伪造的 XHR 完成，并保持与静态 Mock 相同的事件顺序。 */
          const dispatchMockResponse = (mockBody: string): void => {
            setTimeout(() => {
              Object.defineProperty(this, 'readyState', { value: XMLHttpRequest.DONE });
              Object.defineProperty(this, 'status', { value: mockRule.statusCode });
              Object.defineProperty(this, 'responseText', { value: mockBody });
              Object.defineProperty(this, 'response', { value: mockBody });
              this.dispatchEvent(new Event('readystatechange'));
              this.dispatchEvent(new Event('load'));
              this.dispatchEvent(new Event('loadend'));
            }, totalDelayMs);
          };
          if (mockRule.mode === MockResponseMode.Dynamic) {
            void readXhrBodyText(body).then(async (requestBody) => {
              /** 动态 Mock 函数生成的响应体。 */
              const mockBody = await resolveMockBody(
                mockRule,
                createDynamicRequestContext(
                  url,
                  requestMetadata?.method ?? 'GET',
                  requestMetadata?.headers ?? {},
                  requestBody,
                ),
              );
              dispatchMockResponse(mockBody);
            });
          } else {
            dispatchMockResponse(mockRule.body);
          }
          return;
        }

        /** 当前 XHR 实例引用，供异步回调内调用原始 send。 */
        const xhr = this;
        /**
         * 按累计延迟发出真实请求。
         * @param realBody 最终请求体
         */
        const dispatchSend = (realBody?: Document | XMLHttpRequestBodyInit | null): void => {
          if (totalDelayMs > 0) {
            setTimeout(() => originalSend.call(xhr, realBody), totalDelayMs);
          } else {
            originalSend.call(xhr, realBody);
          }
        };

        // 关键步骤：命中改请求体规则时，算出新请求体后再按延迟发送
        if (modifyBodyRule && requestMetadata?.method !== 'GET' && requestMetadata?.method !== 'HEAD') {
          // 静态 Replace 无需原体；JSON 深合并与动态模式需先（可能异步）读取原始请求体文本。
          if (
            modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic ||
            modifyBodyRule.mode === RequestBodyMode.MergeJson
          ) {
            void readXhrBodyText(body).then(async (originalBody) => {
              /** 动态模式执行函数，静态模式沿用既有 JSON 深合并。 */
              const nextBody =
                modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic
                  ? await executeDynamicRequestBody(
                      modifyBodyRule.functionCode ?? '',
                      createDynamicRequestContext(
                        url,
                        requestMetadata?.method ?? 'GET',
                        requestMetadata?.headers ?? {},
                        originalBody,
                      ),
                      originalBody,
                    )
                  : modifyRequestBody(
                      modifyBodyRule.mode,
                      modifyBodyRule.content,
                      originalBody,
                    );
              dispatchSend(nextBody);
            });
          } else {
            dispatchSend(modifyRequestBody(modifyBodyRule.mode, modifyBodyRule.content, ''));
          }
          return;
        }

        // 仅延迟：推迟真实 send
        if (totalDelayMs > 0) {
          setTimeout(() => originalSend.call(this, body), totalDelayMs);
          return;
        }

        originalSend.call(this, body);
      };

      // 含请求体匹配条件时，先读取一次请求体做二次过滤再执行；否则直接沿用初筛结果
      if (rulesNeedBody(candidateRules)) {
        void readXhrBodyText(body).then((bodyText) =>
          proceed(filterRulesByBody(candidateRules, bodyText)),
        );
        return;
      }
      proceed(candidateRules);
    };
  },
});
