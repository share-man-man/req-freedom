import type {
  BodyMatchType,
  HeaderOperation,
  HeaderTarget,
  HttpMethod,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  MockBodyType,
  MockResponseDelivery,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleHitOutcome,
  RuleHitSkipReason,
  RuleScopeType,
  SseDebugClient,
  SseDebugCommandFailureReason,
  SseDebugSendKind,
  SseDebugSessionStatus,
  SseEndBehavior,
  SseSendMode,
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

/** SSE Mock 中按顺序发送的一条事件。 */
export interface SseEvent {
  /** 自定义事件名；缺省时派发 message 事件。 */
  event?: string;
  /** 事件数据；多行内容会编码为多条 data 字段。 */
  data: string;
  /** 可选的事件 ID；EventSource 重连时可用于恢复进度。 */
  id?: string;
  /** 可选的浏览器重连等待时间（毫秒）。 */
  retryMs?: number;
  /** 发送本事件前等待的时间（毫秒）；缺省时使用默认延迟。 */
  delayMs?: number;
}

/**
 * 返回值 Mock 规则
 */
export interface MockResponseAction {
  /** 动作类型。 */
  type: RuleActionType.MockResponse;
  /** 响应体生成方式：静态文本 / 动态 JavaScript 函数 */
  mode: MockResponseMode;
  /** 响应交付方式；缺省为一次性交付，兼容历史规则。SSE 仅支持静态 Mock。 */
  delivery?: MockResponseDelivery;
  /** 响应状态码 */
  statusCode: number;
  /** 可选的 HTTP 状态说明；HAR 导入时保留原始 statusText，缺省为空字符串 */
  statusText?: string;
  /** 附加响应头 */
  responseHeaders?: Record<string, string>;
  /** 静态模式下响应体的内容类型；决定编辑器高亮与默认 Content-Type（缺省 JSON，向后兼容旧数据） */
  bodyType?: MockBodyType;
  /** 静态模式下的响应体（字符串形式，JSON 请自行序列化） */
  body: string;
  /** 动态模式下的 JavaScript 函数体；可使用 req 入参并返回任意响应值 */
  functionCode?: string;
  /**
   * 是否先发出真实请求，再把真实响应交给动态函数改写（「基于真实响应」模式）。
   *
   * 缺省或 false 时 Mock 是短路的：不产生任何真实网络请求，响应完全由规则构造。
   * 置为 true 时改为包装语义，动态函数额外获得 `res` 快照，状态码与响应头一律沿用真实响应，
   * 规则自身的 `statusCode` / `statusText` / `responseHeaders` 不再参与。
   * 仅 `MockResponseMode.Dynamic` 有效——静态模式下发真实请求再整体丢弃没有意义。
   */
  passthrough?: boolean;
  /** SSE 模式下按顺序发送的事件列表。 */
  sseEvents?: SseEvent[];
  /** SSE 事件发送完毕后的行为；缺省关闭。 */
  sseEndBehavior?: SseEndBehavior;
  /** SSE 事件发送方式；缺省为自动发送，以兼容已有规则。 */
  sseSendMode?: SseSendMode;
  /** 返回前的额外延迟（毫秒） */
  delayMs?: number;
}

/** 当前页面中可查询和控制的一次手动 SSE Mock 连接。 */
export interface SseDebugSession {
  /** MAIN world 创建的会话 ID。 */
  id: string;
  /** 命中的业务规则 ID。 */
  ruleId: string;
  /** 请求的绝对 URL。 */
  url: string;
  /** 发起请求的客户端类型。 */
  client: SseDebugClient;
  /** 下一条预设事件的数组下标；保持连接后的自定义发送不会继续递增。 */
  nextEventIndex: number;
  /** 当前已知的事件总数。 */
  eventCount: number;
  /** 当前运行状态。 */
  status: SseDebugSessionStatus;
  /** 建立连接的时间戳。 */
  connectedAt: number;
}

/** UI 请求手动发送下一条 SSE 事件时携带的当前事件快照。 */
export interface SseDebugSendNextCommand {
  /** 目标会话 ID。 */
  sessionId: string;
  /** 发送规则预设事件，或在保持连接后发送临时自定义事件。 */
  kind: SseDebugSendKind;
  /** UI 当前看到的预设事件游标；自定义事件发送时等于预设事件总数。 */
  eventIndex: number;
  /** 当前预设或自定义事件；字段可能包含 popup 中的本次临时修改。 */
  event: SseEvent;
  /** 当前连接确认的预设事件总数；自定义事件不会增加该值。 */
  eventCount: number;
  /** 当前已保存配置的流结束行为。 */
  endBehavior: SseEndBehavior;
}

/** MAIN world 对单步命令的处理结果。 */
export type SseDebugCommandResult =
  | {
      /** 命令已执行。 */
      ok: true;
      /** 执行后的页面会话快照。 */
      session: SseDebugSession;
    }
  | {
      /** 命令未执行。 */
      ok: false;
      /** 命令失败原因。 */
      reason: SseDebugCommandFailureReason;
      /** 会话存在时返回最新快照，供陈旧 UI 立即校准。 */
      session?: SseDebugSession;
    };

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

/** 命中记录的公共字段。 */
interface BaseRuleHit {
  /** 业务规则 ID。 */
  ruleId: string;
  /** 命中的动作类型。 */
  action: RuleActionType;
  /** 触发命中的请求 URL。 */
  url: string;
  /** 触发命中的请求方法。 */
  method: string;
  /** 记录时间。 */
  at: number;
}

/** 动作已实际执行的命中记录。 */
interface AppliedRuleHit extends BaseRuleHit {
  /** 执行结果。 */
  outcome: RuleHitOutcome.Applied;
}

/** 规则匹配上了、但本次请求无法应用的命中记录。 */
interface SkippedRuleHit extends BaseRuleHit {
  /** 执行结果。 */
  outcome: RuleHitOutcome.Skipped;
  /** 无法应用的原因；跳过必然有原因，因此这里不是可选字段。 */
  reason: RuleHitSkipReason;
}

/**
 * 一次规则动作的记录，DNR 与页面补丁两条通道共用。
 *
 * 命中日志是唯一的原始数据；界面上的各种投影都由它派生，不单独维护计数器。
 *
 * 刻意用判别联合而不是「outcome 字段 + 可选 reason」：后者允许写出「已执行却带着跳过原因」
 * 这类自相矛盾的记录，前者在类型上就排除了。
 */
export type RuleHit = AppliedRuleHit | SkippedRuleHit;

/**
 * 单个标签页的完整命中日志。
 *
 * 命中日志是唯一的原始数据：徽标、popup 摘要与请求日志视图都是它的投影。
 * 结构同时用于 background 的内存权威存储、storage.session 镜像与跨上下文消息。
 */
export interface RuleHitLog {
  /** 按记录顺序保存的命中。 */
  hits: RuleHit[];
  /** 是否已因超出上限丢弃过最早的记录。 */
  truncated: boolean;
}

/**
 * 一个仍保有命中日志的标签页概览，供请求日志视图的标签页选择器展示。
 *
 * 只给出数量与活跃时间，标签页标题 / URL 由调用方自行向浏览器查询——它们随时会变，
 * 存在命中日志里只会过期。
 */
export interface RuleHitTabSummary {
  /** 标签页 ID。 */
  tabId: number;
  /** 该标签页当前保留的命中条数。 */
  total: number;
  /** 最后一条命中的时间；用于按活跃度排序。 */
  lastHitAt: number;
}

/** popup 通过 storage.session 交给 options 页的一次性规则定位请求。 */
export interface RuleHighlightRequest {
  /** 要定位的业务规则 ID。 */
  ruleId: string;
  /** 每次请求的唯一标识，确保连续定位同一规则也能产生 storage 变更。 */
  requestId: string;
}

/**
 * 一条规则在 DNR 注册阶段被浏览器拒绝的记录。
 *
 * DNR 规则由浏览器校验，非法规则会被拒绝且**不会生效**。而命中统计是用同一份业务规则
 * 重新判定出来的「预测」，若不知道哪些规则实际没注册成功，就会把它们照常算作命中——
 * 规则明明没生效、界面却显示它命中了，会把排查引向错误方向。
 */
export interface DnrRegistrationIssue {
  /** 注册失败的动作类型；一条规则的多个动作各自独立注册，可能只有部分失败。 */
  actions: RuleActionType[];
  /** 浏览器返回的原始错误信息，用于定位具体哪里不合法。 */
  message: string;
}

/** 按业务规则 ID 索引的 DNR 注册失败记录。 */
export type DnrRegistrationIssues = Record<string, DnrRegistrationIssue>;

/**
 * 当前标签页的命中摘要，供 popup 展示命中规则数与逐规则标记。
 *
 * 只给出去重后的规则 ID：popup 关心的是「哪些规则生效了」，而不是各触发了多少次；
 * 次数信息仍完整保留在命中日志里，留给后续的请求日志视图。
 */
export interface RuleHitSummary {
  /** 本页实际生效过的业务规则 ID，已按规则去重，保持首次命中顺序。 */
  ruleIds: string[];
  /**
   * 本页匹配上、但一次都没能应用的规则及其原因。
   *
   * 同一规则若也有实际生效的记录则不出现在这里——「生效过」是更重要的事实，
   * 界面上一条规则只有一个状态位，不需要同时表达两种结果。
   */
  skippedRuleIds: Record<string, RuleHitSkipReason>;
  /** 日志是否因超出上限而丢弃过最早的记录。 */
  truncated: boolean;
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
