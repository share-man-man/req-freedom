import {
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  RuleType,
} from '@req-freedom/shared';

/** 规则类型的中文展示名（UI 统一引用，避免各处硬编码） */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  [RuleType.Block]: '请求拦截',
  [RuleType.Redirect]: '重定向',
  [RuleType.InjectParams]: '参数注入',
  [RuleType.ModifyHeaders]: 'Header 改写',
  [RuleType.MockResponse]: '返回值 Mock',
  [RuleType.Delay]: '延迟模拟',
  [RuleType.InsertScript]: '脚本注入',
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
