import {
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  NetworkThrottlePreset,
  RequestBodyMode,
  RuleType,
} from '@req-freedom/shared';

/** 规则类型的中文展示名（UI 统一引用，避免各处硬编码） */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  [RuleType.Block]: '请求拦截',
  [RuleType.Redirect]: '重定向',
  [RuleType.InjectParams]: '参数注入',
  [RuleType.ModifyHeaders]: 'Header 改写',
  [RuleType.MockResponse]: '返回值 Mock',
  [RuleType.Delay]: '网络限速',
  [RuleType.InsertScript]: '脚本注入',
  [RuleType.ModifyRequestBody]: '改请求体',
};

/**
 * 各规则类型的说明文案：先讲这条规则做什么，再讲作用范围与主要限制，
 * 与 request-lab 卡片描述的风格看齐，帮助用户看清自己正在添加的是什么规则、降低配置误解。
 */
export const RULE_TYPE_SCOPE_HINTS: Record<RuleType, string> = {
  [RuleType.Block]:
    '拦截并阻断命中的请求，页面会看到该资源加载失败。作用于所有类型的浏览器请求：页面导航、脚本、图片、接口等。',
  [RuleType.Redirect]:
    '把命中的请求重定向到指定目标地址，最终 URL 与响应都会变成目标。作用于所有类型的浏览器请求：页面导航、脚本、图片、接口等。',
  [RuleType.InjectParams]:
    '向命中请求的 URL 追加查询参数（如 debug=1），可在日志与 Network 面板看到最终 URL。作用于所有类型的浏览器请求：页面导航、脚本、图片、接口等。',
  [RuleType.ModifyHeaders]:
    '对命中请求的请求头或响应头做设置、追加或移除。作用于所有类型的浏览器请求：页面导航、脚本、图片、接口等；完整头信息请在 Network 面板核对。',
  [RuleType.MockResponse]:
    '不再真正发出请求，直接用自定义状态码、响应头和响应体返回。仅拦截当前页面脚本发起的 fetch / XHR，不作用于页面导航或静态资源。',
  [RuleType.Delay]:
    '对命中请求施加网络延迟或上下行带宽限制，用于模拟弱网、观察 loading 与耗时。仅作用于当前页面脚本发起的 fetch / XHR，不作用于页面导航或静态资源。',
  [RuleType.InsertScript]:
    '按页面 URL 注入自定义 JS 或 CSS：JS 可改写页面变量与 DOM，CSS 可改变页面样式。匹配顶层页面地址，不针对单个网络请求。',
  [RuleType.ModifyRequestBody]:
    '在请求发出前改写其请求体：可整体替换，或把 JSON 补丁深合并进原请求体。仅作用于当前页面脚本发起的 fetch / XHR，不作用于页面导航或静态资源。',
};

/** 请求体改写模式的中文展示名 */
export const REQUEST_BODY_MODE_LABELS: Record<RequestBodyMode, string> = {
  [RequestBodyMode.Replace]: '整体替换',
  [RequestBodyMode.MergeJson]: 'JSON 深合并',
};

/** 网络限速档位的展示文案 */
export const NETWORK_THROTTLE_PRESET_LABELS: Record<NetworkThrottlePreset, string> = {
  [NetworkThrottlePreset.Fast3G]: 'Fast 3G',
  [NetworkThrottlePreset.Slow3G]: 'Slow 3G',
  [NetworkThrottlePreset.Custom]: '自定义',
};

/** 注入代码类型的中文展示名 */
export const INSERT_SCRIPT_CODE_TYPE_LABELS: Record<InsertScriptCodeType, string> = {
  [InsertScriptCodeType.JavaScript]: 'JavaScript',
  [InsertScriptCodeType.Css]: 'CSS',
};

/** 注入时机的中文展示名 */
export const INSERT_SCRIPT_TIMING_LABELS: Record<InsertScriptTiming, string> = {
  [InsertScriptTiming.DocumentStart]: '文档开始 (document_start)',
  [InsertScriptTiming.DocumentEnd]: '文档就绪 (document_end)',
};

/** 匹配方式的中文展示名 */
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  [MatchType.Contains]: '包含',
  [MatchType.Equals]: '完全相等',
  [MatchType.Wildcard]: '通配符',
  [MatchType.Regex]: '正则',
};

/** Header 作用目标的中文展示名 */
export const HEADER_TARGET_LABELS: Record<HeaderTarget, string> = {
  [HeaderTarget.Request]: '请求头',
  [HeaderTarget.Response]: '响应头',
};

/** Header 操作的中文展示名 */
export const HEADER_OPERATION_LABELS: Record<HeaderOperation, string> = {
  [HeaderOperation.Set]: '设置',
  [HeaderOperation.Append]: '追加',
  [HeaderOperation.Remove]: '移除',
};
