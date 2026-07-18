import {
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  NetworkThrottlePreset,
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
};

/** 各规则类型的实际作用范围与主要限制，供规则编辑器降低配置误解。 */
export const RULE_TYPE_SCOPE_HINTS: Record<RuleType, string> = {
  [RuleType.Block]: '网络层规则：作用于所有命中的浏览器请求，包括页面导航、脚本、图片与接口请求。',
  [RuleType.Redirect]: '网络层规则：作用于所有命中的浏览器请求，包括页面导航、脚本、图片与接口请求。',
  [RuleType.InjectParams]: '网络层规则：作用于所有命中的浏览器请求，包括页面导航、脚本、图片与接口请求。',
  [RuleType.ModifyHeaders]: '网络层规则：作用于所有命中的浏览器请求；可改请求头或响应头。',
  [RuleType.MockResponse]: '页面补丁规则：仅拦截当前页面脚本发起的 fetch / XHR，不作用于页面导航或静态资源。',
  [RuleType.Delay]: '页面补丁规则：仅限速当前页面脚本发起的 fetch / XHR，不作用于页面导航或静态资源。',
  [RuleType.InsertScript]: '页面规则：按顶层页面 URL 注入 JS / CSS，不匹配单个网络请求。',
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
