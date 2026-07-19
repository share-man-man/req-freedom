import type {
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  NetworkThrottlePreset,
  RequestBodyMode,
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
  /** 网络档位。 */
  throttlePreset: NetworkThrottlePreset;
  /** 往返延迟（毫秒）；仅自定义档位使用。 */
  latencyMs: number;
  /** 内部下行带宽（千比特/秒）；仅自定义档位使用，0 表示不限制。UI 按 kB/s 展示。 */
  downloadKbps: number;
  /** 内部上行带宽（千比特/秒）；仅自定义档位使用，0 表示不限制。UI 按 kB/s 展示。 */
  uploadKbps: number;
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
 * 请求体改写规则
 *
 * 在请求真正发出前改写其请求体。走页面补丁通道（MAIN world），仅作用于页面脚本
 * 发起的 fetch / XHR；浏览器原生请求（页面导航、静态资源）拿不到请求体，不在作用范围内。
 */
export interface ModifyRequestBodyRule extends BaseRule {
  type: RuleType.ModifyRequestBody;
  /** 改写模式：整体替换 / JSON 深合并 */
  mode: RequestBodyMode;
  /** 改写内容：Replace 模式为新的请求体文本；MergeJson 模式为要深合并进原请求体的 JSON 文本 */
  content: string;
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
  | InsertScriptRule
  | ModifyRequestBodyRule;

/**
 * 规则分组：一组规则的收纳容器，可整组启停
 *
 * 分组是存储的顶层文档模型：规则嵌套在分组内，数组顺序即展示与匹配顺序。
 * 一条规则最终是否生效，取决于「全局开关 && 分组 enabled && 规则 enabled」三者同时为真。
 */
export interface RuleGroup {
  /** 分组唯一 ID */
  id: string;
  /** 分组名称（展示用） */
  name: string;
  /** 分组是否启用；关闭后组内所有规则一律不生效 */
  enabled: boolean;
  /** 最近一次修改分组或其内部规则的时间（ISO 8601） */
  updatedAt: string;
  /** 组内规则列表（数组顺序即展示与匹配顺序） */
  rules: Rule[];
}

/**
 * 可移植的插件配置文件。
 *
 * `schemaVersion` 让后续存储模型变更可通过迁移兼容，而不会把版本差异隐含在规则数据中。
 */
export interface ConfigurationExport {
  /** 配置文件 schema 版本 */
  schemaVersion: number;
  /** 导出时间（ISO 8601） */
  exportedAt: string;
  /** 全局规则开关 */
  enabled: boolean;
  /** 按顺序保存的全部规则分组 */
  groups: RuleGroup[];
}
