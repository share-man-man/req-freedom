import type { Rule } from '@req-freedom/shared';
import {
  BodyMatchType,
  HttpMethod,
  MatchType,
  MockBodyType,
  MockResponseMode,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';

/** 单次导入允许处理的 HAR 最大条目数，避免超大文件阻塞扩展页。 */
const HAR_IMPORT_MAX_ENTRIES = 1000;

/** 单条静态响应允许导入的最大文本字节数。 */
const HAR_IMPORT_MAX_BODY_BYTES = 1024 * 1024;

/** 导入过程可展示的稳定警告代码。 */
export const RULE_IMPORT_WARNING = {
  SensitiveQuery: 'sensitive-query',
  RequestHeadersIgnored: 'request-headers-ignored',
  BinaryBodySkipped: 'binary-body-skipped',
  BodyTooLarge: 'body-too-large',
  DuplicateRequest: 'duplicate-request',
  UnsupportedEntry: 'unsupported-entry',
} as const;

/** 导入警告代码类型。 */
export type RuleImportWarningCode =
  (typeof RULE_IMPORT_WARNING)[keyof typeof RULE_IMPORT_WARNING];

/** cURL 解析出的平台无关请求快照。 */
export interface ImportedHttpRequest {
  /** 不含 URL fragment 的绝对地址。 */
  url: string;
  /** 请求方法。 */
  method: HttpMethod;
  /** 解析出的请求头；仅用于提示，不会自动改写请求。 */
  headers: Record<string, string>;
  /** 可选请求体。 */
  body?: string;
}

/** 可由 UI 进一步编辑或批量提交的规则候选。 */
export interface RuleImportCandidate {
  /** 来源中的稳定索引。 */
  sourceIndex: number;
  /** 建议规则名。 */
  suggestedName: string;
  /** 已补齐运行时 ID 的规则草稿。 */
  rule: Rule;
  /** 不阻止导入的警告代码。 */
  warnings: RuleImportWarningCode[];
  /** 用于识别重复 URL + 方法的指纹。 */
  fingerprint: string;
  /** 原始响应体的 UTF-8 字节数。 */
  bodyBytes: number;
}

/** cURL 转换的目标动作。 */
export type CurlRuleTarget = RuleActionType.MockResponse | RuleActionType.Redirect;

/** HAR 的普通对象形态。 */
type UnknownRecord = Record<string, unknown>;

/**
 * 判断未知值是否为普通对象。
 * @param value 待判断值
 * @returns 普通对象判断结果
 */
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将 shell 风格的 cURL 文本切分为参数，不执行任何命令或变量展开。
 * @param input 用户粘贴的 cURL 文本
 * @returns 已解除引号的参数列表
 */
function tokenizeCurl(input: string): string[] {
  /** 去掉反斜杠换行后的命令文本。 */
  const command = input.replace(/\\\r?\n/g, ' ').trim();
  if (!command) {
    throw new Error('curl-empty');
  }
  /** 参数列表。 */
  const tokens: string[] = [];
  /** 当前参数缓冲。 */
  let current = '';
  /** 当前引号状态。 */
  let quote: "'" | '"' | null = null;
  /** 当前是否正在转义下一个字符。 */
  let escaped = false;
  /** 当前参数是否已经开始。 */
  let started = false;

  for (const character of command) {
    if (escaped) {
      current += character;
      started = true;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    if ('|;&><`'.includes(character) || character === '$') {
      throw new Error('curl-shell-syntax-unsupported');
    }
    current += character;
    started = true;
  }

  if (escaped || quote) {
    throw new Error('curl-quote-unclosed');
  }
  if (started) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * 把字符串转换成受支持的 HTTP 方法。
 * @param value 原始方法名
 * @returns 统一枚举值
 */
function parseHttpMethod(value: string): HttpMethod {
  /** 规范化后的方法名。 */
  const normalized = value.toUpperCase();
  /** 受支持的方法枚举。 */
  const method = Object.values(HttpMethod).find((item) => item === normalized);
  if (!method) {
    throw new Error('http-method-unsupported');
  }
  return method;
}

/**
 * 解析 Chrome 等工具复制出的常见 cURL 请求。
 * @param input cURL 命令文本
 * @returns 请求快照
 */
export function parseCurlRequest(input: string): ImportedHttpRequest {
  /** 切分后的参数。 */
  const tokens = tokenizeCurl(input);
  if (tokens[0] !== 'curl') {
    throw new Error('curl-command-required');
  }
  /** 请求头映射。 */
  const headers: Record<string, string> = {};
  /** 收集到的 data 参数。 */
  const dataParts: string[] = [];
  /** 显式请求方法。 */
  let explicitMethod: string | undefined;
  /** 请求 URL。 */
  let rawUrl: string | undefined;
  /** 是否使用 GET 查询参数模式。 */
  let useGet = false;

  /**
   * 读取指定下标后的必需参数。
   * @param index 当前选项下标
   * @returns 下一项参数
   */
  const requireNext = (index: number): string => {
    /** 当前选项后的参数。 */
    const value = tokens[index + 1];
    if (value === undefined) {
      throw new Error('curl-option-value-required');
    }
    return value;
  };

  for (let index = 1; index < tokens.length; index += 1) {
    /** 当前参数。 */
    const token = tokens[index] ?? '';
    if (token === '-X' || token === '--request') {
      explicitMethod = requireNext(index);
      index += 1;
      continue;
    }
    if (token.startsWith('-X') && token.length > 2) {
      explicitMethod = token.slice(2);
      continue;
    }
    if (token === '-H' || token === '--header') {
      /** Header 原始文本。 */
      const header = requireNext(index);
      /** Header 名和值的分隔位置。 */
      const separator = header.indexOf(':');
      if (separator > 0) {
        /** Header 名。 */
        const name = header.slice(0, separator).trim();
        headers[name] = header.slice(separator + 1).trim();
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-H') && token.length > 2) {
      /** 紧凑形式 Header 文本。 */
      const header = token.slice(2);
      /** Header 名和值的分隔位置。 */
      const separator = header.indexOf(':');
      if (separator > 0) {
        /** Header 名。 */
        const name = header.slice(0, separator).trim();
        headers[name] = header.slice(separator + 1).trim();
      }
      continue;
    }
    if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(token)) {
      /** data 选项值。 */
      const value = requireNext(index);
      if (value.startsWith('@')) {
        throw new Error('curl-file-input-unsupported');
      }
      dataParts.push(value);
      index += 1;
      continue;
    }
    if (token === '--url') {
      rawUrl = requireNext(index);
      index += 1;
      continue;
    }
    if (token === '-G' || token === '--get') {
      useGet = true;
      continue;
    }
    if (token === '--config' || token === '-K') {
      throw new Error('curl-config-unsupported');
    }
    if (token.startsWith('-')) {
      continue;
    }
    rawUrl ??= token;
  }

  if (!rawUrl) {
    throw new Error('curl-url-required');
  }
  /** 解析后的绝对 URL。 */
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('curl-url-invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('curl-url-invalid');
  }
  url.hash = '';
  if (useGet && dataParts.length > 0) {
    /** 合并后的查询串。 */
    const query = dataParts.join('&');
    /** cURL 的 -G 会把 data 追加到查询参数。 */
    const extra = new URLSearchParams(query);
    extra.forEach((value, key) => url.searchParams.append(key, value));
  }
  /** 最终请求方法。 */
  const method = parseHttpMethod(
    explicitMethod ?? (useGet || dataParts.length === 0 ? HttpMethod.Get : HttpMethod.Post),
  );
  /** 非 GET 模式下的请求体。 */
  const body = !useGet && dataParts.length > 0 ? dataParts.join('&') : undefined;
  return { url: url.toString(), method, headers, ...(body !== undefined ? { body } : {}) };
}

/**
 * 根据 cURL 请求生成可交给单条编辑器继续完善的规则草稿。
 * @param request 已解析请求
 * @param target 目标动作
 * @param redirectUrl 可选重定向地址
 * @returns 新规则草稿
 */
export function createRuleFromCurl(
  request: ImportedHttpRequest,
  target: CurlRuleTarget,
  redirectUrl = 'https://example.com/target',
): Rule {
  /** URL 路径，用于生成可读名称。 */
  const url = new URL(request.url);
  /** GraphQL 请求体中的 operationName。 */
  let operationName: string | undefined;
  if (request.body) {
    try {
      /** JSON 请求体。 */
      const parsed = JSON.parse(request.body) as unknown;
      if (isRecord(parsed) && typeof parsed.operationName === 'string') {
        operationName = parsed.operationName;
      }
    } catch {
      // 普通文本请求体无需生成自动匹配条件。
    }
  }
  /** 规则动作。 */
  const actions: Rule['actions'] =
    target === RuleActionType.Redirect
      ? [{ type: RuleActionType.Redirect, redirectUrl }]
      : [{
          type: RuleActionType.MockResponse,
          mode: MockResponseMode.Static,
          bodyType: MockBodyType.Json,
          statusCode: 200,
          body: '{\n  \"code\": 0\n}',
        }];
  return {
    id: crypto.randomUUID(),
    name: `${request.method} ${operationName ?? url.pathname}`,
    enabled: true,
    channel:
      target === RuleActionType.Redirect
        ? RuleExecutionChannel.Dnr
        : RuleExecutionChannel.PagePatch,
    methods: [request.method],
    matchType: MatchType.Equals,
    pattern: request.url,
    ...(operationName
      ? { bodyMatch: { type: BodyMatchType.GraphQlOperation, value: operationName } }
      : {}),
    actions,
  };
}

/**
 * 将 HAR Header 数组转换为字符串映射。
 * @param value HAR headers 字段
 * @returns Header 映射
 */
function parseHarHeaders(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return {};
  }
  /** Header 映射。 */
  const headers: Record<string, string> = {};
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.value !== 'string') {
      continue;
    }
    /** 统一后的 Header 名。 */
    const name = item.name.trim();
    if (name) {
      headers[name] = headers[name] ? `${headers[name]}, ${item.value}` : item.value;
    }
  }
  return headers;
}

/**
 * 根据 MIME 类型推断现有 MockBodyType。
 * @param mimeType HAR MIME 类型
 * @returns 支持的文本类型，二进制返回 undefined
 */
function inferMockBodyType(mimeType: string): MockBodyType | undefined {
  /** 去掉 charset 等参数后的 MIME。 */
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalized.includes('json') || normalized.endsWith('+json')) return MockBodyType.Json;
  if (normalized === 'text/html') return MockBodyType.Html;
  if (normalized.includes('xml') || normalized.endsWith('+xml')) return MockBodyType.Xml;
  if (normalized.includes('javascript') || normalized.includes('ecmascript')) {
    return MockBodyType.JavaScript;
  }
  if (normalized === 'text/css') return MockBodyType.Css;
  if (normalized.startsWith('text/')) return MockBodyType.Text;
  return undefined;
}

/**
 * 解码 HAR 中 base64 编码的 UTF-8 响应体。
 * @param value base64 文本
 * @returns UTF-8 字符串
 */
function decodeBase64Text(value: string): string {
  /** 解码后的二进制字符串。 */
  const binary = atob(value);
  /** UTF-8 字节数组。 */
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 过滤不能安全重放的响应头。
 * @param headers HAR 响应头
 * @returns 可写入 Mock 动作的响应头
 */
function filterMockResponseHeaders(headers: Record<string, string>): Record<string, string> {
  /** 不应随重建响应继续使用的传输层 Header。 */
  const blocked = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'set-cookie',
    'set-cookie2',
    'transfer-encoding',
  ]);
  /** 安全响应头。 */
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

/**
 * 从 HAR 1.2 JSON 生成静态 Mock 候选规则。
 * @param content HAR 文件文本
 * @returns 可批量预览的候选规则
 */
export function parseHarRules(content: string): RuleImportCandidate[] {
  /** HAR 顶层未知数据。 */
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('har-json-invalid');
  }
  if (!isRecord(parsed) || !isRecord(parsed.log) || !Array.isArray(parsed.log.entries)) {
    throw new Error('har-structure-invalid');
  }
  /** 受最大数量限制的 HAR 条目。 */
  const entries = parsed.log.entries.slice(0, HAR_IMPORT_MAX_ENTRIES);
  /** 已出现的请求指纹。 */
  const fingerprints = new Set<string>();
  /** 生成的规则候选。 */
  const candidates: RuleImportCandidate[] = [];

  entries.forEach((entryValue, sourceIndex) => {
    if (!isRecord(entryValue) || !isRecord(entryValue.request) || !isRecord(entryValue.response)) {
      return;
    }
    /** 请求对象。 */
    const request = entryValue.request;
    /** 响应对象。 */
    const response = entryValue.response;
    /** Chrome HAR 扩展字段中的资源类型。 */
    const resourceType =
      typeof entryValue._resourceType === 'string'
        ? entryValue._resourceType.toLowerCase()
        : undefined;
    if (resourceType && !['fetch', 'xhr'].includes(resourceType)) {
      return;
    }
    if (typeof request.url !== 'string' || typeof request.method !== 'string') {
      return;
    }
    /** 响应内容对象。 */
    const responseContent = isRecord(response.content) ? response.content : undefined;
    if (!responseContent || typeof responseContent.text !== 'string') {
      return;
    }
    /** 响应 MIME 类型。 */
    const mimeType =
      typeof responseContent.mimeType === 'string'
        ? responseContent.mimeType
        : '';
    /** 映射后的响应体类型。 */
    const bodyType = inferMockBodyType(mimeType);
    if (!bodyType) {
      return;
    }
    /** 解析后的请求方法。 */
    let method: HttpMethod;
    try {
      method = parseHttpMethod(request.method);
    } catch {
      return;
    }
    /** 规范化后的请求 URL。 */
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return;
    }
    if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
      return;
    }
    requestUrl.hash = '';
    /** 解码后的响应体。 */
    let body: string;
    try {
      body =
        responseContent.encoding === 'base64'
          ? decodeBase64Text(responseContent.text)
          : responseContent.text;
    } catch {
      return;
    }
    /** 响应体 UTF-8 字节数。 */
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > HAR_IMPORT_MAX_BODY_BYTES) {
      return;
    }
    /** HAR 请求体对象。 */
    const postData = isRecord(request.postData) ? request.postData : undefined;
    /** 可选 GraphQL operationName。 */
    let operationName: string | undefined;
    if (postData && typeof postData.text === 'string') {
      try {
        /** HAR 中的 JSON 请求体。 */
        const requestBody = JSON.parse(postData.text) as unknown;
        if (isRecord(requestBody) && typeof requestBody.operationName === 'string') {
          operationName = requestBody.operationName;
        }
      } catch {
        // 普通请求体保持 URL + 方法匹配。
      }
    }
    /** 请求指纹；GraphQL 操作名可区分同端点下的不同操作。 */
    const fingerprint = `${method} ${requestUrl.toString()} ${operationName ?? ''}`;
    /** 当前候选警告。 */
    const warnings: RuleImportWarningCode[] = [];
    if (fingerprints.has(fingerprint)) {
      warnings.push(RULE_IMPORT_WARNING.DuplicateRequest);
    }
    fingerprints.add(fingerprint);
    if (/[?&](?:access_token|api[_-]?key|token|signature|auth)=/i.test(requestUrl.search)) {
      warnings.push(RULE_IMPORT_WARNING.SensitiveQuery);
    }
    /** HAR 响应状态码。 */
    const statusCode =
      typeof response.status === 'number' && response.status >= 100 && response.status <= 599
        ? response.status
        : 200;
    /** HAR 响应头。 */
    const responseHeaders = filterMockResponseHeaders(parseHarHeaders(response.headers));
    /** 用于生成规则名的路径。 */
    const pathLabel = operationName ?? requestUrl.pathname;
    /** Mock 动作。 */
    const action: Rule['actions'][number] = {
      type: RuleActionType.MockResponse,
      mode: MockResponseMode.Static,
      statusCode,
      ...(typeof response.statusText === 'string' && response.statusText
        ? { statusText: response.statusText }
        : {}),
      bodyType,
      body,
      ...(Object.keys(responseHeaders).length > 0 ? { responseHeaders } : {}),
    };
    /** 候选规则。 */
    const rule: Rule = {
      id: crypto.randomUUID(),
      name: `${method} ${pathLabel}`,
      enabled: true,
      channel: RuleExecutionChannel.PagePatch,
      methods: [method],
      matchType: MatchType.Equals,
      pattern: requestUrl.toString(),
      ...(operationName
        ? { bodyMatch: { type: BodyMatchType.GraphQlOperation, value: operationName } }
        : {}),
      actions: [action],
    };
    candidates.push({
      sourceIndex,
      suggestedName: rule.name,
      rule,
      warnings,
      fingerprint,
      bodyBytes,
    });
  });
  return candidates;
}
