import type {
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  RuleType,
} from './enums';

/**
 * 所有规则的公共字段
 */
export interface BaseRule {
  /** 规则唯一 ID */
  id: string;
  /** 规则名称（展示用） */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** URL 匹配方式 */
  matchType: MatchType;
  /** URL 匹配模式（子串 / 完整 URL / 通配符 / 正则，取决于 matchType） */
  pattern: string;
}

/**
 * 拦截规则：直接阻断请求
 */
export interface BlockRule extends BaseRule {
  type: RuleType.Block;
}

/**
 * 重定向规则
 */
export interface RedirectRule extends BaseRule {
  type: RuleType.Redirect;
  /** 重定向目标地址；正则匹配时支持 \1 形式的捕获组引用 */
  redirectUrl: string;
}

/**
 * 参数注入规则：向 URL 查询串中添加/覆盖参数
 */
export interface InjectParamsRule extends BaseRule {
  type: RuleType.InjectParams;
  /** 要注入的查询参数键值对 */
  params: Record<string, string>;
}

/**
 * 单条 Header 修改项
 */
export interface HeaderModification {
  /** 作用于请求头还是响应头 */
  target: HeaderTarget;
  /** 操作类型 */
  operation: HeaderOperation;
  /** Header 名称 */
  header: string;
  /** Header 值（Remove 操作时可省略） */
  value?: string;
}

/**
 * Header 改写规则
 */
export interface ModifyHeadersRule extends BaseRule {
  type: RuleType.ModifyHeaders;
  /** 修改项列表 */
  headers: HeaderModification[];
}

/**
 * 返回值 Mock 规则
 */
export interface MockResponseRule extends BaseRule {
  type: RuleType.MockResponse;
  /** 响应状态码 */
  statusCode: number;
  /** 附加响应头 */
  responseHeaders?: Record<string, string>;
  /** 响应体（字符串形式，JSON 请自行序列化） */
  body: string;
  /** 返回前的额外延迟（毫秒） */
  delayMs?: number;
}

/**
 * 延迟模拟规则
 */
export interface DelayRule extends BaseRule {
  type: RuleType.Delay;
  /** 延迟时长（毫秒） */
  delayMs: number;
}

/**
 * 脚本 / 样式注入规则
 *
 * 按页面 URL 命中，向页面注入自定义 JS 或 CSS。走页面补丁通道（MAIN world），
 * 匹配的是顶层文档 URL 而非单个请求。
 */
export interface InsertScriptRule extends BaseRule {
  type: RuleType.InsertScript;
  /** 注入代码的类型（JS / CSS） */
  codeType: InsertScriptCodeType;
  /** 注入时机（document_start / document_end） */
  timing: InsertScriptTiming;
  /** 要注入的代码内容 */
  code: string;
}

/**
 * 规则联合类型（按 type 字段做判别）
 */
export type Rule =
  | BlockRule
  | RedirectRule
  | InjectParamsRule
  | ModifyHeadersRule
  | MockResponseRule
  | DelayRule
  | InsertScriptRule;
