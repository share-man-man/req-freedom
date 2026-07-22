/** 规则的实际执行通道。 */
export enum RuleExecutionChannel {
  /** Chrome declarativeNetRequest 网络层规则。 */
  Dnr = 'dnr',
  /** MAIN world 中的 fetch / XHR / 页面注入补丁。 */
  PagePatch = 'page-patch',
}

/** 通道内可组合的动作类型；仅用于统一规则模型与执行分发。 */
export enum RuleActionType {
  Block = 'block',
  Redirect = 'redirect',
  InjectParams = 'inject-params',
  ModifyHeaders = 'modify-headers',
  MockResponse = 'mock-response',
  Delay = 'delay',
  InsertScript = 'insert-script',
  ModifyRequestBody = 'modify-request-body',
}

/** HTTP 请求方法。 */
export enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
  Patch = 'PATCH',
  Delete = 'DELETE',
  Head = 'HEAD',
  Options = 'OPTIONS',
}

/**
 * Mock 响应生成方式
 */
export enum MockResponseMode {
  /** 直接返回配置中的静态响应体文本 */
  Static = 'static',
  /** 在页面上下文执行 JavaScript，根据请求动态生成响应体 */
  Dynamic = 'dynamic',
}

/**
 * 静态 Mock 响应体的内容类型
 *
 * 同时决定编辑器语法高亮与交付时的默认 Content-Type。
 */
export enum MockBodyType {
  /** JSON（application/json） */
  Json = 'json',
  /** 纯文本（text/plain） */
  Text = 'text',
  /** HTML（text/html） */
  Html = 'html',
  /** XML（application/xml） */
  Xml = 'xml',
  /** JavaScript（text/javascript） */
  JavaScript = 'javascript',
  /** CSS（text/css） */
  Css = 'css',
}

/**
 * 请求体改写模式
 */
export enum RequestBodyMode {
  /** 用静态内容整体替换原请求体 */
  Replace = 'replace',
  /** 把 JSON 补丁深合并进原请求体（原请求体须为 JSON 对象） */
  MergeJson = 'merge-json',
}

/**
 * 请求体内容来源
 */
export enum RequestBodySourceMode {
  /** 使用静态文本按 RequestBodyMode 规则改写 */
  Static = 'static',
  /** 在页面上下文执行 JavaScript，根据请求动态生成最终请求体 */
  Dynamic = 'dynamic',
}

/**
 * 网络限速预设
 */
export enum NetworkThrottlePreset {
  /** Chrome DevTools 常用的 Fast 3G 档位 */
  Fast3G = 'fast-3g',
  /** Chrome DevTools 常用的 Slow 3G 档位 */
  Slow3G = 'slow-3g',
  /** 由用户分别填写延迟、上下行速率 */
  Custom = 'custom',
}

/**
 * 注入代码的类型（决定以 <script> 还是 <style> 注入）
 */
export enum InsertScriptCodeType {
  /** JavaScript 代码，注入后在页面上下文执行 */
  JavaScript = 'js',
  /** CSS 样式，注入后作用于页面 */
  Css = 'css',
}

/**
 * 注入时机（对齐内容脚本 run_at 语义）
 */
export enum InsertScriptTiming {
  /** 文档开始解析时注入，早于页面自身脚本 */
  DocumentStart = 'document_start',
  /** DOM 构建完成（DOMContentLoaded）后注入 */
  DocumentEnd = 'document_end',
}

/**
 * URL 匹配方式
 */
export enum MatchType {
  /** 包含子串 */
  Contains = 'contains',
  /** 完全相等 */
  Equals = 'equals',
  /** 通配符（* 匹配任意字符） */
  Wildcard = 'wildcard',
  /** 正则表达式 */
  Regex = 'regex',
}

/**
 * 请求体匹配方式
 *
 * 在 URL + 方法之外，按请求体内容进一步收敛命中范围。仅页面补丁通道可读取请求体，
 * 因此该条件只对页面补丁规则生效；GraphQL 场景下所有操作共用同一 URL 与方法，
 * 只能靠请求体里的 operationName 区分。
 */
export enum BodyMatchType {
  /** 请求体文本包含指定子串 */
  Contains = 'contains',
  /** 请求体文本匹配指定正则 */
  Regex = 'regex',
  /** 请求体 JSON 的 operationName 等于指定值（GraphQL 操作名） */
  GraphQlOperation = 'graphql-operation',
}

/**
 * Header 改写的作用目标
 */
export enum HeaderTarget {
  /** 请求头 */
  Request = 'request',
  /** 响应头 */
  Response = 'response',
}

/**
 * Header 改写操作
 */
export enum HeaderOperation {
  /** 设置（覆盖） */
  Set = 'set',
  /** 追加 */
  Append = 'append',
  /** 移除 */
  Remove = 'remove',
}
