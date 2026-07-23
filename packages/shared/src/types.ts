import type {
  BodyMatchType,
  HeaderOperation,
  HeaderTarget,
  HttpMethod,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  MockBodyType,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleScopeType,
} from './enums';

/**
 * 所有规则的公共字段
 */
interface BaseRule {
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

interface BlockAction {
  /** 动作类型。 */
  type: RuleActionType.Block;
}

interface RedirectAction {
  /** 动作类型。 */
  type: RuleActionType.Redirect;
  /** 重定向目标地址；正则匹配时支持 \1 形式的捕获组引用 */
  redirectUrl: string;
}

/**
 * 参数注入规则：向 URL 查询串中添加/覆盖参数
 */
interface InjectParamsAction {
  /** 动作类型。 */
  type: RuleActionType.InjectParams;
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
interface ModifyHeadersAction {
  /** 动作类型。 */
  type: RuleActionType.ModifyHeaders;
  /** 修改项列表 */
  headers: HeaderModification[];
}

/**
 * 返回值 Mock 规则
 */
export interface MockResponseAction {
  /** 动作类型。 */
  type: RuleActionType.MockResponse;
  /** 响应体生成方式：静态文本 / 动态 JavaScript 函数 */
  mode: MockResponseMode;
  /** 响应状态码 */
  statusCode: number;
  /** 附加响应头 */
  responseHeaders?: Record<string, string>;
  /** 静态模式下响应体的内容类型；决定编辑器高亮与默认 Content-Type（缺省 JSON，向后兼容旧数据） */
  bodyType?: MockBodyType;
  /** 静态模式下的响应体（字符串形式，JSON 请自行序列化） */
  body: string;
  /** 动态模式下的 JavaScript 函数体；可使用 req 入参并返回任意响应值 */
  functionCode?: string;
  /** 返回前的额外延迟（毫秒） */
  delayMs?: number;
}

/**
 * 延迟模拟规则
 */
export interface DelayAction {
  /** 动作类型。 */
  type: RuleActionType.Delay;
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
export interface InsertScriptAction {
  /** 动作类型。 */
  type: RuleActionType.InsertScript;
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
interface ModifyRequestBodyAction {
  /** 动作类型。 */
  type: RuleActionType.ModifyRequestBody;
  /** 内容来源：静态文本 / 动态 JavaScript 函数 */
  sourceMode: RequestBodySourceMode;
  /** 静态内容的改写模式：整体替换 / JSON 深合并；动态模式下保留以兼容旧配置但不参与执行 */
  mode: RequestBodyMode;
  /** 静态内容：Replace 模式为新的请求体文本；MergeJson 模式为要深合并进原请求体的 JSON 文本 */
  content: string;
  /** 动态模式下的 JavaScript 函数体；可使用 req 入参并返回最终请求体 */
  functionCode?: string;
}

/** 规则内可组合的具体动作。 */
export type RuleAction =
  | BlockAction
  | RedirectAction
  | InjectParamsAction
  | ModifyHeadersAction
  | MockResponseAction
  | DelayAction
  | InsertScriptAction
  | ModifyRequestBodyAction;

/**
 * 请求体匹配条件
 *
 * 在 URL 与方法之外，按请求体内容进一步收敛命中范围。仅页面补丁通道能读取请求体，
 * 因此该条件只对页面补丁规则生效；DNR 规则携带该字段时运行时会忽略它。
 */
export interface BodyMatcher {
  /** 请求体匹配方式 */
  type: BodyMatchType;
  /** 匹配值：Contains 为子串、Regex 为正则、GraphQlOperation 为 operationName */
  value: string;
}

/**
 * 作用域内的单个目标对象
 *
 * 记录浏览器运行时的数字 ID 与选择时的展示标签：运行时匹配只依赖 id，label 仅供 UI 展示与失效标注。
 * tab / window / tabGroup 的 ID 都是会话级的，浏览器重启后即失效——对安全用途而言这是 fail-closed 的，
 * 失效后规则不再命中，不会把敏感请求误发出去。
 */
export interface ScopeTarget {
  /** 目标对象的浏览器运行时数字 ID（tabId / windowId / tabGroup id） */
  id: number;
  /** 选择时记录的展示标签（标签页标题 / 窗口名 / 分组名），仅用于 UI 展示 */
  label: string;
}

/**
 * 规则作用域条件
 *
 * 在 URL / 方法 / 请求体之外，把规则的生效范围限定到具体的浏览器上下文。
 * 缺省或 `type` 为 AllTabs 时不限制作用范围（等价于历史行为）。
 */
export interface RuleScope {
  /** 作用域类型 */
  type: RuleScopeType;
  /** 目标对象列表；AllTabs 时为空数组 */
  targets: ScopeTarget[];
}

/**
 * 作用域匹配所需的运行时上下文
 *
 * 由页面补丁通道的桥接脚本从自身标签解析得到；字段缺省（如 background 尚未回传上下文）时，
 * 只应命中 AllTabs 规则，避免作用域规则在上下文未知时误生效。
 */
export interface ScopeContext {
  /** 当前标签页 ID */
  tabId?: number;
  /** 当前标签所在窗口 ID */
  windowId?: number;
  /** 当前标签所属标签组 ID；未归组时为浏览器的 chrome.tabGroups.TAB_GROUP_ID_NONE（-1） */
  groupId?: number;
}

/**
 * 统一规则模型。
 *
 * 一条规则只有一个执行通道；相同 URL / 方法匹配条件下可组合多个该通道支持的动作。
 */
export interface Rule extends BaseRule {
  /** 规则的执行通道。 */
  channel: RuleExecutionChannel;
  /** 允许命中的 HTTP 方法；空数组表示全部方法。 */
  methods: HttpMethod[];
  /** 可选的请求体匹配条件；缺省表示不按请求体收敛。仅页面补丁通道生效。 */
  bodyMatch?: BodyMatcher;
  /** 可选的作用域条件；缺省或 AllTabs 表示不限制生效范围。两条通道均生效。 */
  scope?: RuleScope;
  /** 命中后依次执行的动作。 */
  actions: RuleAction[];
}

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
