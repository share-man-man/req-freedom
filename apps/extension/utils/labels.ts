import {
  BodyMatchType,
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  MockBodyType,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleScopeType,
  RuleTemplateCategory,
} from '@req-freedom/shared';

/** 常用规则模板归类的中文展示名。 */
export const RULE_TEMPLATE_CATEGORY_LABELS: Record<RuleTemplateCategory, string> = {
  [RuleTemplateCategory.Cors]: '跨域 CORS',
  [RuleTemplateCategory.Cache]: '缓存控制',
  [RuleTemplateCategory.Protocol]: '协议与重定向',
  [RuleTemplateCategory.UserAgent]: 'User-Agent',
};

/** 规则动作类型的中文展示名。 */
export const RULE_ACTION_TYPE_LABELS: Record<RuleActionType, string> = {
  [RuleActionType.Block]: '拦截请求',
  [RuleActionType.Redirect]: '重定向',
  [RuleActionType.InjectParams]: '参数注入',
  [RuleActionType.ModifyHeaders]: 'Header 改写',
  [RuleActionType.MockResponse]: '返回值 Mock',
  [RuleActionType.Delay]: '网络限速',
  [RuleActionType.ModifyRequestBody]: '改请求体',
  [RuleActionType.InsertScript]: '脚本注入',
};

/** 请求体改写模式的中文展示名 */
export const REQUEST_BODY_MODE_LABELS: Record<RequestBodyMode, string> = {
  [RequestBodyMode.Replace]: '整体替换',
  [RequestBodyMode.MergeJson]: 'JSON 深合并',
};

/** 请求体内容来源的中文展示名。 */
export const REQUEST_BODY_SOURCE_MODE_LABELS: Record<RequestBodySourceMode, string> = {
  [RequestBodySourceMode.Static]: '静态改写',
  [RequestBodySourceMode.Dynamic]: 'JavaScript 动态生成',
};

/** Mock 响应生成方式的中文展示名。 */
export const MOCK_RESPONSE_MODE_LABELS: Record<MockResponseMode, string> = {
  [MockResponseMode.Static]: '静态响应体',
  [MockResponseMode.Dynamic]: 'JavaScript 动态生成',
};

/** 静态 Mock 响应体类型的展示名。 */
export const MOCK_BODY_TYPE_LABELS: Record<MockBodyType, string> = {
  [MockBodyType.Json]: 'JSON',
  [MockBodyType.Text]: '文本',
  [MockBodyType.Html]: 'HTML',
  [MockBodyType.Xml]: 'XML',
  [MockBodyType.JavaScript]: 'JavaScript',
  [MockBodyType.Css]: 'CSS',
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

/** 请求体匹配方式的中文展示名 */
export const BODY_MATCH_TYPE_LABELS: Record<BodyMatchType, string> = {
  [BodyMatchType.Contains]: '包含子串',
  [BodyMatchType.Regex]: '正则',
  [BodyMatchType.GraphQlOperation]: 'GraphQL 操作名',
};

/** 请求体匹配值输入框的占位提示，随匹配方式变化。 */
export const BODY_MATCH_VALUE_PLACEHOLDERS: Record<BodyMatchType, string> = {
  [BodyMatchType.Contains]: '请求体需包含的子串',
  [BodyMatchType.Regex]: '匹配请求体的正则，如 "mutation\\\\s+Login"',
  [BodyMatchType.GraphQlOperation]: 'operationName，如 GetUser',
};

/** 规则作用域类型的中文展示名 */
export const RULE_SCOPE_TYPE_LABELS: Record<RuleScopeType, string> = {
  [RuleScopeType.AllTabs]: '全部标签页',
  [RuleScopeType.Tab]: '指定标签页',
  [RuleScopeType.Window]: '指定窗口',
  [RuleScopeType.TabGroup]: '指定标签组',
};

/** 作用域为空（未选择任何目标对象）时各类型的提示文案 */
export const RULE_SCOPE_EMPTY_HINTS: Record<RuleScopeType, string> = {
  [RuleScopeType.AllTabs]: '',
  [RuleScopeType.Tab]: '勾选一个或多个当前打开的标签页',
  [RuleScopeType.Window]: '勾选一个或多个当前打开的窗口',
  [RuleScopeType.TabGroup]: '勾选一个或多个当前的标签组',
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
