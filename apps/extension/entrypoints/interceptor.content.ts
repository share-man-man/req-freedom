import { defineContentScript } from 'wxt/utils/define-content-script';
import type {
  DelayAction,
  InsertScriptAction,
  MockResponseAction,
  Rule,
  RuleHit,
} from '@req-freedom/shared';
import {
  DEFAULT_MOCK_BODY_TYPE,
  DEFAULT_MOCK_CONTENT_TYPE,
  InsertScriptCodeType,
  InsertScriptTiming,
  MOCK_BODY_TYPE_CONTENT_TYPES,
  MockResponseDelivery,
  MockResponseMode,
  PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE,
  PAGE_PORT_MSG_RULE_HITS,
  PAGE_PORT_MSG_RULES,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleHitSkipReason,
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
  resolveDynamicVariables,
  resolveDynamicVariablesInRecord,
  rulesNeedBody,
  sleep,
} from '@req-freedom/core';
import {
  isPassthroughMock,
  resolvePagePlan,
  resolveSyncXhrSkippedHits,
  toSkippedHit,
  type PagePlan,
} from '@/utils/page-plan';
import { createAppliedHit } from '@/utils/rule-hit';
import {
  createMockEventSource,
  createSseReadableStream,
  SSE_CONTENT_TYPE,
} from '@/utils/sse';

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

/**
 * 「基于真实响应」的 Mock 中，动态函数额外获得的响应快照。
 *
 * 仅在 Mock 动作开启 passthrough 时提供；短路 Mock 不产生真实请求，该入参为 undefined。
 */
interface DynamicResponseContext {
  /** 真实响应的最终 URL（重定向后的地址）。 */
  url: string;
  /** HTTP 状态码；网络失败时为 0。 */
  status: number;
  /** HTTP 状态说明。 */
  statusText: string;
  /** 状态码是否落在 2xx。 */
  ok: boolean;
  /** 真实响应头，键为小写 Header 名。 */
  headers: Record<string, string>;
  /** 响应体的文本形式。 */
  body: string;
  /** 响应体为合法 JSON 时的解析结果。 */
  json?: unknown;
}

/** XHR 在 open / setRequestHeader 阶段收集的请求元信息。 */
interface XhrRequestMetadata {
  /** 请求的绝对 URL。 */
  url: string;
  /** open 调用传入的 HTTP 方法。 */
  method: string;
  /** open 调用是否使用异步模式；同步 XHR 无法承载页面补丁的异步处理。 */
  isAsync: boolean;
  /** setRequestHeader 调用设置的请求头。 */
  headers: Record<string, string>;
}

/** XHR Mock 完成后供只读属性与响应头 API 查询的响应快照。 */
interface XhrMockResponseState {
  /** Mock 请求对应的最终 URL。 */
  url: string;
  /** HTTP 状态码。 */
  status: number;
  /** HTTP 状态说明。 */
  statusText: string;
  /** 已解析动态变量并补齐 Content-Type 的响应头。 */
  headers: Record<string, string>;
  /** Mock 响应体文本。 */
  body: string;
}

/**
 * 拦截内容脚本（MAIN world）
 *
 * 在页面自身的 JS 环境中给 fetch / XMLHttpRequest 打补丁，
 * 实现 DNR 无法覆盖的两类能力：返回值 Mock、网络限速模拟。
 * 规则由 bridge.content.ts 通过 document_start 时建立的私有 MessagePort 推送。
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

    /** 用于与 ISOLATED world bridge 建立私有通信的 MessageChannel。 */
    const bridgeChannel = new MessageChannel();
    /** MAIN world 保留、专门收发规则和动作计数的私有端口。 */
    const bridgePort = bridgeChannel.port1;

    /**
     * 通知桥接脚本当前页面实际执行的动作。
     * @param hits 本次执行产生的命中记录
     */
    const reportRuleHits = (hits: RuleHit[]): void => {
      if (hits.length === 0) {
        return;
      }
      bridgePort.postMessage({ type: PAGE_PORT_MSG_RULE_HITS, hits });
    };

    /**
     * 上报 Mock 的命中记录。
     *
     * 与限速、改请求体不同，Mock 能否应用要到执行时才知道，因此不随计划一起上报，
     * 由各执行分支在确认结果后调用：传入原因即记为「匹配上但未应用」。
     * @param hit 计划阶段生成的 Mock 命中记录
     * @param reason 无法应用的原因；省略表示已实际应用
     */
    const reportMockHit = (hit: RuleHit | undefined, reason?: RuleHitSkipReason): void => {
      if (!hit) {
        return;
      }
      reportRuleHits([reason ? toSkippedHit(hit, reason) : hit]);
    };

    // 私有端口只接受 bridge 推送的规则更新，宿主页无法伪造后续动作消息。
    bridgePort.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== PAGE_PORT_MSG_RULES) {
        return;
      }
      state.enabled = Boolean(event.data.enabled);
      state.rules = Array.isArray(event.data.rules) ? (event.data.rules as Rule[]) : [];
      // 规则到达后按需注入命中当前页面的脚本 / 样式
      applyInsertScripts();
    };
    bridgePort.start();

    // document_start 时只通过 window 暴露一次握手端口，后续消息全部走私有 MessageChannel。
    window.postMessage(
      { source: PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE },
      '*',
      [bridgeChannel.port2],
    );

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
        /** 当前注入动作所属的业务规则。 */
        const ownerRule = matched.find((rule) => rule.actions.includes(action));
        if (!ownerRule) {
          continue;
        }
        /** 注入动作唯一 ID，由规则 ID 与动作类型拼接而成。 */
        const actionId = `${ownerRule.id}:${action.type}`;
        if (injectedRuleIds.has(actionId)) {
          continue;
        }
        // 立即标记，避免重推时重复注入或重复挂载 DOMContentLoaded 监听
        injectedRuleIds.add(actionId);
        /**
         * 注入完成后上报一条命中；注入本身就是执行，无需二次推导。
         */
        const injectAndReport = (): void => {
          injectCode(action);
          reportRuleHits([
            createAppliedHit(ownerRule.id, action.type, {
              url: window.location.href,
              method: 'GET',
              at: Date.now(),
            }),
          ]);
        };
        if (action.timing === InsertScriptTiming.DocumentEnd && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', injectAndReport, { once: true });
        } else {
          injectAndReport();
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
     * 基于真实响应改写时，函数异常或未返回值都保留真实响应体，避免一处笔误就把页面数据打空；
     * 短路 Mock 没有可回退的真实响应，仍以结构化错误对象暴露问题。
     * @param rule 命中的动态 Mock 规则
     * @param request 传入用户代码的请求快照
     * @param response 「基于真实响应」模式下的真实响应快照；短路 Mock 为 undefined
     * @returns 字符串响应体；对象与其他 JSON 值会自动序列化
     */
    const executeDynamicMock = async (
      rule: MockResponseAction,
      request: DynamicRequestContext,
      response?: DynamicResponseContext,
    ): Promise<string> => {
      try {
        // 用户代码是一个完整函数（如 function mock(req, res){...}）；括号包成函数表达式后立即调用，兼容普通与 async 函数
        const execute = new Function(
          'req',
          'res',
          `"use strict"; return (\n${rule.functionCode ?? ''}\n)(req, res);`,
        ) as (req: DynamicRequestContext, res?: DynamicResponseContext) => Promise<unknown>;
        /** 用户函数返回的原始值。 */
        const result = await execute(request, response);
        if (typeof result === 'string') {
          return result;
        }
        // 基于真实响应时，不返回值约定为「不改写」，与动态改请求体的语义保持一致
        if (result === undefined && response) {
          return response.body;
        }
        /** JSON.stringify(undefined) 会返回 undefined，响应体应稳定回退为空文本。 */
        const serialized = JSON.stringify(result);
        return serialized ?? '';
      } catch (error) {
        /** 便于开发者在页面控制台定位函数执行错误。 */
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Req Freedom] 动态 Mock 函数执行失败：', error);
        if (response) {
          return response.body;
        }
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
      rule.mode === MockResponseMode.Dynamic
        ? executeDynamicMock(rule, request)
        : resolveDynamicVariables(rule.body);

    /**
     * 构造传给动态函数的响应快照。
     * @param url 真实响应的最终 URL
     * @param status HTTP 状态码
     * @param statusText HTTP 状态说明
     * @param headers 真实响应头（键为小写 Header 名）
     * @param body 响应体文本
     * @returns 供用户函数读取的响应信息
     */
    const createDynamicResponseContext = (
      url: string,
      status: number,
      statusText: string,
      headers: Record<string, string>,
      body: string,
    ): DynamicResponseContext => {
      /** 当响应体为合法 JSON 时供用户函数直接使用的解析值。 */
      let json: unknown;
      try {
        json = body ? JSON.parse(body) : undefined;
      } catch {
        // 非 JSON 响应体是正常情况，仍通过 body 原文提供给用户函数。
      }
      return {
        url,
        status,
        statusText,
        ok: status >= 200 && status < 300,
        headers,
        body,
        ...(json === undefined ? {} : { json }),
      };
    };

    /**
     * 把 XHR 的原始响应头文本解析成普通对象。
     * @param raw getAllResponseHeaders 返回的 CRLF 分隔文本
     * @returns 小写 Header 名与值组成的映射
     */
    const parseRawResponseHeaders = (raw: string): Record<string, string> => {
      /** 解析后的响应头映射。 */
      const record: Record<string, string> = {};
      for (const line of raw.split('\r\n')) {
        /** Header 名与值的分隔位置。 */
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
          continue;
        }
        record[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
      }
      return record;
    };

    /**
     * 构造 Fetch 与 XHR 共用的 Mock 响应头。
     * @param rule 命中的 Mock 动作
     * @returns 补齐默认 Content-Type 并解析动态变量后的响应头
     */
    const buildMockResponseHeaders = (rule: MockResponseAction): Record<string, string> => {
      /** 静态模式按响应体类型推导 Content-Type，动态模式回落到默认 JSON。 */
      const contentType =
        rule.delivery === MockResponseDelivery.Sse
          ? SSE_CONTENT_TYPE
          : rule.mode === MockResponseMode.Static
          ? MOCK_BODY_TYPE_CONTENT_TYPES[rule.bodyType ?? DEFAULT_MOCK_BODY_TYPE]
          : DEFAULT_MOCK_CONTENT_TYPE;
      /** 解析动态变量后的显式响应头。 */
      const resolvedHeaders = rule.responseHeaders
        ? resolveDynamicVariablesInRecord(rule.responseHeaders)
        : {};
      /** 显式配置的 Content-Type，忽略 Header 名大小写。 */
      const explicitContentType = Object.entries(resolvedHeaders).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1];
      /** 移除不同大小写的 Content-Type，最终只保留一个规范键。 */
      const remainingHeaders = Object.fromEntries(
        Object.entries(resolvedHeaders).filter(
          ([name]) => name.toLowerCase() !== 'content-type',
        ),
      );
      return {
        ...remainingHeaders,
        ...(rule.delivery === MockResponseDelivery.Sse &&
        !Object.keys(remainingHeaders).some((name) => name.toLowerCase() === 'cache-control')
          ? { 'Cache-Control': 'no-cache' }
          : {}),
        'Content-Type':
          rule.delivery === MockResponseDelivery.Sse
            ? contentType
            : explicitContentType ?? contentType,
      };
    };

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

    /** 不允许携带响应体的状态码，重建 Response 时必须传 null。 */
    const NULL_BODY_STATUSES = new Set([204, 205, 304]);

    /**
     * 按改请求体规则算出最终要传给原始 fetch 的初始化参数。
     *
     * 未命中改请求体规则、或方法不允许携带请求体时原样返回 init。
     * @param modifyBodyRule 命中的改请求体动作
     * @param input fetch 的第一个参数
     * @param init fetch 的可选初始化参数
     * @param url 绝对化后的请求 URL
     * @param method 本次请求实际使用的 HTTP 方法
     * @returns 可直接传给原始 fetch 的初始化参数
     */
    const resolveFetchInit = async (
      modifyBodyRule: PagePlan['modifyBody'],
      input: RequestInfo | URL,
      init: RequestInit | undefined,
      url: string,
      method: string,
    ): Promise<RequestInit | undefined> => {
      if (!modifyBodyRule || method === 'GET' || method === 'HEAD') {
        return init;
      }
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
                method,
                headersToRecord(getFetchHeaders(input, init)),
                originalBody,
              ),
              originalBody,
            )
          : modifyRequestBody(modifyBodyRule.mode, resolveDynamicVariables(modifyBodyRule.content), originalBody);
      // input 为 Request 时其 method / headers 仍被保留，init.body 仅覆盖请求体
      return { ...init, body: nextBody };
    };

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
      /** 本次请求的执行计划；命中记录与执行动作同源，不再事后推导。 */
      const plan = resolvePagePlan(activeRules, url, method, Date.now());
      const { mock: mockRule, delay: delayRule, modifyBody: modifyBodyRule } = plan;
      // 限速与改请求体计划成立即执行，可立即上报；Mock 等确认结果后再报
      reportRuleHits(plan.hits);

      // 关键步骤：在请求实际发出前模拟网络往返延迟与上行传输时间
      if (delayRule) {
        /** 由请求体大小和网络档位共同计算的请求前等待时间。 */
        const requestDelayMs = getNetworkRequestDelayMs(
          delayRule,
          getFetchBodyByteLength(input, init),
        );
        await sleep(requestDelayMs);
      }

      // 关键步骤：基于真实响应的 Mock 仍会发出真实请求，只把响应体交给动态函数改写
      if (mockRule && isPassthroughMock(mockRule)) {
        await sleep(mockRule.delayMs ?? 0);
        /** 请求快照需在真实请求发出前构造，否则 Request 的请求体可能已被消费而无法克隆。 */
        const requestContext = createDynamicRequestContext(
          url,
          method,
          headersToRecord(getFetchHeaders(input, init)),
          await readFetchBodyText(input, init),
        );
        /** 真实网络响应（请求体已按改请求体规则改写）。 */
        const realResponse = await originalFetch(
          input,
          await resolveFetchInit(modifyBodyRule, input, init, url, method),
        );
        // 不透明响应（no-cors / opaqueredirect）读不到 body 也无法重建，原样放行
        if (realResponse.type === 'opaque' || realResponse.type === 'opaqueredirect' || realResponse.status === 0) {
          reportMockHit(plan.mockHit, RuleHitSkipReason.OpaqueResponse);
          return throttleResponse(realResponse, delayRule);
        }
        /** 真实响应体文本；读取失败时按空串处理，交由动态函数决定如何降级。 */
        const originalResponseBody = await realResponse.text().catch(() => '');
        /** 动态函数改写后的响应体。 */
        const mockBody = await executeDynamicMock(
          mockRule,
          requestContext,
          createDynamicResponseContext(
            realResponse.url,
            realResponse.status,
            realResponse.statusText,
            headersToRecord(realResponse.headers),
            originalResponseBody,
          ),
        );
        /** 沿用真实响应状态码与响应头、只替换响应体的最终响应。 */
        const response = new Response(
          NULL_BODY_STATUSES.has(realResponse.status) ? null : mockBody,
          { status: realResponse.status, statusText: realResponse.statusText, headers: realResponse.headers },
        );
        // Response 构造器无法接收 url / redirected；显式覆盖以保持调用方可观察到的元数据不变。
        Object.defineProperties(response, {
          url: { value: realResponse.url },
          redirected: { value: realResponse.redirected },
        });
        reportMockHit(plan.mockHit);
        return throttleResponse(response, delayRule);
      }

      // 关键步骤：命中 Mock 时直接构造响应，不发起真实请求
      if (mockRule) {
        // 短路 Mock 必定应用：响应完全由规则构造，没有会失败的执行环节
        reportMockHit(plan.mockHit);
        await sleep(mockRule.delayMs ?? 0);
        if (mockRule.delivery === MockResponseDelivery.Sse) {
          /** SSE Mock 按事件各自的等待时间逐块交付，避免把整个事件列表缓冲成普通文本。 */
          const response = new Response(
            createSseReadableStream(mockRule, resolveDynamicVariables),
            {
              status: mockRule.statusCode,
              statusText: mockRule.statusText,
              headers: buildMockResponseHeaders(mockRule),
            },
          );
          return throttleResponse(response, delayRule);
        }
        /** 动态模式读取请求快照后生成响应；静态模式使用配置中的 body 并解析其中的动态变量。 */
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
            : resolveDynamicVariables(mockRule.body);
        /** 按网络限速规则交付 Mock 响应，确保 Mock 与真实请求具有一致的弱网表现。 */
        const response = new Response(mockBody, {
          status: mockRule.statusCode,
          statusText: mockRule.statusText,
          headers: buildMockResponseHeaders(mockRule),
        });
        return throttleResponse(response, delayRule);
      }

      // 关键步骤：命中改请求体规则时，在真实请求发出前改写请求体（短路 Mock 不发真实请求，故置于其后）
      if (modifyBodyRule && method !== 'GET' && method !== 'HEAD') {
        /** 请求体已按规则改写的最终 fetch 参数。 */
        const response = await originalFetch(
          input,
          await resolveFetchInit(modifyBodyRule, input, init, url, method),
        );
        return throttleResponse(response, delayRule);
      }

      /** 真实网络响应在响应流层面按下行带宽向页面交付。 */
      const response = await originalFetch(input, init);
      return throttleResponse(response, delayRule);
    };

    // ---------- EventSource 补丁 ----------

    /** 页面原始 EventSource 构造器，未命中 SSE Mock 时完整回落原生实现。 */
    const OriginalEventSource = window.EventSource;
    /** 仅在命中 SSE Mock 时返回本地事件源的代理构造器。 */
    const PatchedEventSource = new Proxy(OriginalEventSource, {
      construct(target, args) {
        /** 构造器收到的原始 URL。 */
        const rawUrl = args[0] as string | URL;
        /** 绝对化后的事件流 URL。 */
        const url = toAbsoluteUrl(rawUrl.toString());
        /** EventSource 的可选初始化参数。 */
        const eventSourceInit = args[1] as EventSourceInit | undefined;
        /** GET 请求初筛命中的页面补丁规则。 */
        const candidateRules = resolveCandidateRules(url, 'GET');
        /** EventSource 没有请求体，带请求体条件的规则只可能按空文本匹配。 */
        const activeRules = rulesNeedBody(candidateRules)
          ? filterRulesByBody(candidateRules, '')
          : candidateRules;
        /** 复用页面补丁计划，确保动作优先级与 fetch / XHR 一致。 */
        const plan = resolvePagePlan(activeRules, url, 'GET', Date.now());
        /** 本次计划命中的 Mock 动作。 */
        const mockRule = plan.mock;
        if (!mockRule || mockRule.delivery !== MockResponseDelivery.Sse) {
          return Reflect.construct(target, args) as EventSource;
        }
        // EventSource 只执行 SSE Mock；普通 Mock、请求体改写和仅限 fetch/XHR 的计划不改变原生连接。
        reportRuleHits(plan.hits);
        reportMockHit(plan.mockHit);
        /** 网络限速规则在 EventSource 上可模拟的首包等待时间。 */
        const networkDelayMs = plan.delay
          ? getNetworkRequestDelayMs(plan.delay, 0)
          : 0;
        return createMockEventSource(
          url,
          eventSourceInit,
          mockRule,
          resolveDynamicVariables,
          { initialDelayMs: networkDelayMs + (mockRule.delayMs ?? 0) },
        );
      },
    });
    window.EventSource = PatchedEventSource;

    // ---------- XMLHttpRequest 补丁 ----------

    /**
     * 从 XHR 规则快照中移除 SSE Mock 动作。
     *
     * XHR 没有可替换的增量响应流；忽略 SSE Mock，但保留同一规则内可正常执行的限速与改请求体动作。
     * @param rules XHR 初筛命中的规则
     * @returns 不含 SSE Mock 动作的规则列表
     */
    const withoutSseMockActions = (rules: Rule[]): Rule[] =>
      rules
        .map((rule) => ({
          ...rule,
          actions: rule.actions.filter(
            (action) =>
              action.type !== RuleActionType.MockResponse ||
              action.delivery !== MockResponseDelivery.Sse,
          ),
        }))
        .filter((rule) => rule.actions.length > 0);

    /** 记录每个 XHR 实例在 open / setRequestHeader 阶段的请求信息，供 send 阶段匹配与动态 Mock 使用。 */
    const xhrRequestMap = new WeakMap<XMLHttpRequest, XhrRequestMetadata>();
    /** 原始 open 方法 */
    const originalOpen = XMLHttpRequest.prototype.open;
    /** 原始 setRequestHeader 方法。 */
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    /** 原始 send 方法 */
    const originalSend = XMLHttpRequest.prototype.send;
    /** 原始单个响应头读取方法。 */
    const originalGetResponseHeader = XMLHttpRequest.prototype.getResponseHeader;
    /** 原始全部响应头读取方法。 */
    const originalGetAllResponseHeaders = XMLHttpRequest.prototype.getAllResponseHeaders;
    /** 每个被 Mock 的 XHR 响应状态。 */
    const xhrMockResponseMap = new WeakMap<XMLHttpRequest, XhrMockResponseState>();

    /**
     * 按改请求体规则算出 XHR 最终要发送的请求体。
     *
     * 未命中改请求体规则、或方法不允许携带请求体时原样返回。
     * @param modifyBodyRule 命中的改请求体动作
     * @param body send 收到的原始请求体
     * @param metadata open / setRequestHeader 阶段记录的请求元信息
     * @param url 绝对化后的请求 URL
     * @param method 本次请求实际使用的 HTTP 方法
     * @returns 可直接传给原始 send 的请求体
     */
    const resolveXhrRequestBody = async (
      modifyBodyRule: PagePlan['modifyBody'],
      body: Document | XMLHttpRequestBodyInit | null | undefined,
      metadata: XhrRequestMetadata | undefined,
      url: string,
      method: string,
    ): Promise<Document | XMLHttpRequestBodyInit | null | undefined> => {
      if (!modifyBodyRule || method === 'GET' || method === 'HEAD') {
        return body;
      }
      /** 原始请求体文本；静态 Replace 无需读取，JSON 深合并与动态模式需要。 */
      const originalBody =
        modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic ||
        modifyBodyRule.mode === RequestBodyMode.MergeJson
          ? await readXhrBodyText(body)
          : '';
      return modifyBodyRule.sourceMode === RequestBodySourceMode.Dynamic
        ? executeDynamicRequestBody(
            modifyBodyRule.functionCode ?? '',
            createDynamicRequestContext(url, method, metadata?.headers ?? {}, originalBody),
            originalBody,
          )
        : modifyRequestBody(modifyBodyRule.mode, resolveDynamicVariables(modifyBodyRule.content), originalBody);
    };

    /**
     * 用影子 XHR 发出真实请求，供「基于真实响应」的 Mock 读取原始响应。
     *
     * 页面持有的那个 XHR 全程不会真正 send：XHR 的 readystatechange / load 由原生同步派发，
     * 一旦放行就会抢在异步的动态函数之前把响应交给页面代码。改由影子实例承载真实请求后，
     * 外层 XHR 只在动态函数返回后才被伪造成完成态，事件顺序完全可控。
     * 影子实例刻意不设置 responseType，保证 responseText 始终可读。
     * @param metadata open / setRequestHeader 阶段记录的请求元信息
     * @param requestBody 最终要发送的请求体
     * @param source 页面持有的 XHR，用于抄取 withCredentials / timeout 等发送前设置
     * @returns 真实响应快照；网络失败、超时或被中断时以 status 0 返回
     */
    const sendShadowXhr = (
      metadata: XhrRequestMetadata | undefined,
      requestBody: Document | XMLHttpRequestBodyInit | null | undefined,
      source: XMLHttpRequest,
    ): Promise<XhrMockResponseState> =>
      new Promise((resolve) => {
        /** 绕开自身补丁的影子实例：open / send / 响应头读取一律走原始方法。 */
        const shadow = new XMLHttpRequest();
        /** 成功与失败路径共用的收敛回调。 */
        const settle = (): void => {
          /** 影子实例读到的响应体文本；responseType 为默认值时始终可读。 */
          let responseBody = '';
          try {
            responseBody = shadow.responseText;
          } catch {
            // 理论上不会发生（未设置 responseType），保险起见按空响应体处理
          }
          resolve({
            url: shadow.responseURL || (metadata?.url ?? ''),
            status: shadow.status,
            statusText: shadow.statusText,
            headers: parseRawResponseHeaders(originalGetAllResponseHeaders.call(shadow)),
            body: responseBody,
          });
        };
        shadow.addEventListener('load', settle);
        shadow.addEventListener('error', settle);
        shadow.addEventListener('abort', settle);
        shadow.addEventListener('timeout', settle);
        originalOpen.call(shadow, metadata?.method ?? 'GET', metadata?.url ?? '', true);
        // 发送前设置直接从页面实例抄取，无需劫持原型描述符即可保持凭证与超时语义一致
        shadow.withCredentials = source.withCredentials;
        shadow.timeout = source.timeout;
        for (const [name, value] of Object.entries(metadata?.headers ?? {})) {
          try {
            originalSetRequestHeader.call(shadow, name, value);
          } catch {
            // 页面可能设置了浏览器禁止改写的 Header 名，跳过该项即可，不影响其余请求头
          }
        }
        originalSend.call(shadow, requestBody ?? null);
      });

    XMLHttpRequest.prototype.getResponseHeader = function getResponseHeader(
      this: XMLHttpRequest,
      name: string,
    ): string | null {
      /** 当前实例的 Mock 响应。 */
      const mockResponse = xhrMockResponseMap.get(this);
      if (!mockResponse) {
        return originalGetResponseHeader.call(this, name);
      }
      if (this.readyState < XMLHttpRequest.HEADERS_RECEIVED) {
        return null;
      }
      /** 规范化后的查询 Header 名。 */
      const normalizedName = name.toLowerCase();
      if (normalizedName === 'set-cookie' || normalizedName === 'set-cookie2') {
        return null;
      }
      /** 忽略大小写命中的响应头。 */
      const entry = Object.entries(mockResponse.headers).find(
        ([headerName]) => headerName.toLowerCase() === normalizedName,
      );
      return entry?.[1] ?? null;
    };

    XMLHttpRequest.prototype.getAllResponseHeaders = function getAllResponseHeaders(
      this: XMLHttpRequest,
    ): string {
      /** 当前实例的 Mock 响应。 */
      const mockResponse = xhrMockResponseMap.get(this);
      if (!mockResponse) {
        return originalGetAllResponseHeaders.call(this);
      }
      if (this.readyState < XMLHttpRequest.HEADERS_RECEIVED) {
        return '';
      }
      return Object.entries(mockResponse.headers)
        .filter(([name]) => !['set-cookie', 'set-cookie2'].includes(name.toLowerCase()))
        .map(([name, value]) => `${name.toLowerCase()}: ${value}\r\n`)
        .join('');
    };

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
        // XHR 规范按 ToBoolean 处理该参数，这里保持一致，避免 0 / '' 等假值被当成异步
        isAsync: Boolean(isAsync),
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
      const candidateRules = withoutSseMockActions(resolveCandidateRules(url, method));

      // 关键步骤：同步 XHR 必须在 send 返回前拿到响应，而页面补丁的 Mock、延迟与请求体改写全都是异步的
      // （读请求体、执行用户函数、影子请求都要等微任务或事件），插进去只会让页面读到空响应。
      // 这里一律原样放行，宁可规则不生效也不破坏页面；DNR 通道的规则不受影响，仍在网络层照常执行。
      if (requestMetadata && !requestMetadata.isAsync) {
        if (candidateRules.length > 0) {
          console.warn(
            '[Req Freedom] 同步 XMLHttpRequest 不支持页面补丁规则，已原样放行：',
            url,
          );
          reportRuleHits(resolveSyncXhrSkippedHits(candidateRules, url, method, Date.now()));
        }
        return originalSend.call(this, body);
      }

      /**
       * 依据（已完成请求体二次过滤的）命中规则执行 Mock / 延迟 / 改请求体 / 真实发送。
       *
       * 以箭头函数承载，`this` 仍指向当前 XHR 实例；请求体二次过滤是否发生不影响这段逻辑。
       * @param activeRules 请求体条件也已命中的规则集
       */
      const proceed = (activeRules: Rule[]): void => {
        /** 本次请求的执行计划；命中记录与执行动作同源，不再事后推导。 */
        const plan = resolvePagePlan(activeRules, url, method, Date.now());
        const { mock: mockRule, delay: delayRule, modifyBody: modifyBodyRule } = plan;
        // XHR 无 no-cors 语义，影子请求失败也会照常把响应交给动态函数改写，Mock 必定应用
        reportRuleHits([...plan.hits, ...(plan.mockHit ? [plan.mockHit] : [])]);
        /** 延迟规则与 Mock 自带延迟的总时长。XHR 不暴露可替换的响应流，因此仅模拟请求前的网络延迟与上行带宽。 */
        const totalDelayMs =
          (delayRule ? getNetworkRequestDelayMs(delayRule, getRequestBodyByteLength(body)) : 0) +
          (mockRule?.delayMs ?? 0);

        // 关键步骤：命中 Mock 时伪造 XHR 完成态并派发事件，短路 Mock 不发起真实请求
        if (mockRule) {
          /**
           * 让伪造的 XHR 完成，并保持与静态 Mock 相同的事件顺序。
           * @param mockBody 最终交给页面代码的响应体
           * @param realResponse 「基于真实响应」模式下影子实例拿到的真实响应；短路 Mock 为 undefined
           */
          const dispatchMockResponse = (mockBody: string, realResponse?: XhrMockResponseState): void => {
            setTimeout(() => {
              // 基于真实响应时，状态码、状态说明与响应头一律沿用真实响应，只替换响应体
              /** 当前 Mock 的完整响应状态。 */
              const mockResponse: XhrMockResponseState = realResponse
                ? { ...realResponse, body: mockBody }
                : {
                    url,
                    status: mockRule.statusCode,
                    statusText: mockRule.statusText ?? '',
                    headers: buildMockResponseHeaders(mockRule),
                    body: mockBody,
                  };
              xhrMockResponseMap.set(this, mockResponse);
              Object.defineProperty(this, 'readyState', {
                configurable: true,
                value: XMLHttpRequest.HEADERS_RECEIVED,
              });
              Object.defineProperty(this, 'status', {
                configurable: true,
                value: mockResponse.status,
              });
              Object.defineProperty(this, 'statusText', {
                configurable: true,
                value: mockResponse.statusText,
              });
              Object.defineProperty(this, 'responseURL', {
                configurable: true,
                value: mockResponse.url,
              });
              this.dispatchEvent(new Event('readystatechange'));
              Object.defineProperty(this, 'readyState', {
                configurable: true,
                value: XMLHttpRequest.LOADING,
              });
              this.dispatchEvent(new Event('readystatechange'));
              /** 按 responseType 转换后的响应值。 */
              let response: unknown = mockBody;
              if (this.responseType === 'json') {
                try {
                  response = JSON.parse(mockBody) as unknown;
                } catch {
                  response = null;
                }
              } else if (this.responseType === 'blob') {
                // 规则构造的响应头用规范大小写，真实响应头一律小写，因此按忽略大小写查找
                response = new Blob([mockBody], {
                  type: Object.entries(mockResponse.headers).find(
                    ([headerName]) => headerName.toLowerCase() === 'content-type',
                  )?.[1] ?? '',
                });
              } else if (this.responseType === 'arraybuffer') {
                response = new TextEncoder().encode(mockBody).buffer;
              } else if (this.responseType === 'document') {
                response = null;
              }
              Object.defineProperty(this, 'readyState', { value: XMLHttpRequest.DONE });
              if (this.responseType === '' || this.responseType === 'text') {
                Object.defineProperty(this, 'responseText', {
                  configurable: true,
                  value: mockBody,
                });
              }
              Object.defineProperty(this, 'response', {
                configurable: true,
                value: response,
              });
              Object.defineProperty(this, 'responseXML', {
                configurable: true,
                value: null,
              });
              this.dispatchEvent(new Event('readystatechange'));
              this.dispatchEvent(new Event('load'));
              this.dispatchEvent(new Event('loadend'));
            }, totalDelayMs);
          };
          // 基于真实响应：由影子实例发出真实请求，拿到响应后再交给动态函数改写
          if (isPassthroughMock(mockRule)) {
            void readXhrBodyText(body).then(async (requestBody) => {
              /** 影子实例拿到的真实响应（请求体已按改请求体规则改写）。 */
              const realResponse = await sendShadowXhr(
                requestMetadata,
                await resolveXhrRequestBody(modifyBodyRule, body, requestMetadata, url, method),
                this,
              );
              /** 动态函数改写后的响应体。 */
              const mockBody = await executeDynamicMock(
                mockRule,
                createDynamicRequestContext(url, method, requestMetadata?.headers ?? {}, requestBody),
                createDynamicResponseContext(
                  realResponse.url,
                  realResponse.status,
                  realResponse.statusText,
                  realResponse.headers,
                  realResponse.body,
                ),
              );
              dispatchMockResponse(mockBody, realResponse);
            });
            return;
          }
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
            dispatchMockResponse(resolveDynamicVariables(mockRule.body));
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
        if (modifyBodyRule && method !== 'GET' && method !== 'HEAD') {
          void resolveXhrRequestBody(modifyBodyRule, body, requestMetadata, url, method).then(dispatchSend);
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
