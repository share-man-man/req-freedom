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

/**
 * 规则作用域类型
 *
 * 在 URL / 方法 / 请求体之外，把规则的生效范围进一步限定到具体的浏览器上下文。
 * 官方场景是安全考量：避免把 Authorization 等敏感 Header 误发到不想发的站点。
 * 两条通道均生效——页面补丁按内容脚本自身的 tab/窗口/分组过滤，
 * DNR 侧把作用域解析成一组 tabId 后以 session 规则的 tabIds 条件承载。
 */
export enum RuleScopeType {
  /** 全部标签页（默认，不限制生效范围） */
  AllTabs = 'all-tabs',
  /** 仅指定标签页 */
  Tab = 'tab',
  /** 仅指定窗口下的标签页 */
  Window = 'window',
  /** 仅指定标签组下的标签页 */
  TabGroup = 'tab-group',
}

/**
 * 常用规则模板的归类
 *
 * 仅用于模板库 UI 的分区展示，不参与规则的执行语义。
 */
export enum RuleTemplateCategory {
  /** 跨域（CORS）相关 */
  Cors = 'cors',
  /** 缓存控制相关 */
  Cache = 'cache',
  /** 协议 / 重定向相关 */
  Protocol = 'protocol',
  /** User-Agent 切换相关 */
  UserAgent = 'user-agent',
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
 * 内置动态变量名
 *
 * 规则的取值字段（重定向 URL、注入参数值、Header 值、Mock 响应体 / 响应头、静态改请求体内容）里可用
 * `{{name}}` 占位符引用；带参数的变量写作 `{{name(arg1,arg2)}}`。解析时机取决于通道：
 * 页面补丁通道逐请求解析（真·动态，每个请求可得到不同值），DNR 通道在规则同步时解析一次
 * （声明式规则无法逐请求求值）。
 */
export enum DynamicVariableName {
  /** 随机 UUID v4 */
  Uuid = 'uuid',
  /** 秒级 Unix 时间戳 */
  Timestamp = 'timestamp',
  /** 毫秒级 Unix 时间戳 */
  TimestampMs = 'timestampMs',
  /** 当前时间的 ISO 8601 字符串 */
  IsoTime = 'isoTime',
  /** 随机整数，`{{randomInt(min,max)}}` 指定闭区间，缺省 0-100 */
  RandomInt = 'randomInt',
  /** [0, 1) 区间的随机浮点数 */
  RandomFloat = 'randomFloat',
  /** 随机字母数字串，`{{randomString(length)}}` 指定长度，缺省 8 位 */
  RandomString = 'randomString',
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
