import {
  DynamicVariableName,
  MockBodyType,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodySourceMode,
} from './enums';

/** storage 中规则分组列表的键名（顶层文档模型：分组内嵌套规则） */
export const STORAGE_KEY_GROUPS = 'req-freedom:groups';

/** storage 中全局开关的键名 */
export const STORAGE_KEY_ENABLED = 'req-freedom:enabled';

/** storage 中界面语言的键名（值为 i18next 语言代码，如 'zh-CN' / 'en'） */
export const STORAGE_KEY_LOCALE = 'req-freedom:locale';

/** storage 中界面主题的键名（值为 ThemeMode）。 */
export const STORAGE_KEY_THEME = 'req-freedom:theme';

/** 导入 / 导出文件当前使用的配置 schema 版本。 */
export const CONFIG_EXPORT_SCHEMA_VERSION = 2;

/** 导出配置文件的文件名固定前缀。 */
export const CONFIG_EXPORT_FILE_NAME_PREFIX = 'req-freedom-config';

/** MAIN world 拦截脚本请求与 ISOLATED world bridge 建立私有 MessagePort 的握手来源。 */
export const PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE = 'req-freedom:page-channel-request';

/** bridge 通过私有 MessagePort 向 MAIN world 推送规则的消息类型。 */
export const PAGE_PORT_MSG_RULES = 'req-freedom:page-rules';

/** MAIN world 通过私有 MessagePort 上报页面补丁命中的消息类型。 */
export const PAGE_PORT_MSG_RULE_HITS = 'req-freedom:page-rule-hits';

/** 桥接脚本把页面补丁命中转交 background 的消息类型。 */
export const RUNTIME_MSG_RULE_HIT = 'req-freedom:rule-hit';

/** popup 向 background 查询当前标签页命中摘要的消息类型。 */
export const RUNTIME_MSG_GET_RULE_HIT_SUMMARY = 'req-freedom:get-rule-hit-summary';

/** popup 通知 background 清空当前标签页命中日志的消息类型。 */
export const RUNTIME_MSG_CLEAR_RULE_HITS = 'req-freedom:clear-rule-hits';

/** storage.session 中按标签页镜像命中日志的键名前缀。 */
export const STORAGE_KEY_RULE_HITS = 'req-freedom:rule-hits';

/**
 * storage.session 中记录 DNR 注册失败规则的键名。
 *
 * 放在 session 而非 local：注册结果随浏览器会话有效，且扩展页面可直接订阅
 * storage.onChanged 拿到更新，无需额外的消息往返。
 */
export const STORAGE_KEY_DNR_ISSUES = 'req-freedom:dnr-issues';

/** options 页面用于定位并高亮规则的查询参数名。 */
export const RULE_HIGHLIGHT_QUERY_PARAM = 'highlightRuleId';

/** declarativeNetRequest 动态规则 ID 起始偏移，避免与其他来源的规则 ID 冲突 */
export const DNR_RULE_ID_OFFSET = 1000;

/**
 * 桥接内容脚本向 background 请求自身标签上下文（tabId / windowId / groupId）的消息类型
 *
 * 内容脚本拿不到自己的 tabId，需由 background 从 sender.tab 读取后回传，
 * 才能按规则作用域过滤要推送给页面的规则。
 */
export const RUNTIME_MSG_GET_SCOPE_CONTEXT = 'req-freedom:get-scope-context';

/**
 * background 主动向某个标签推送最新作用域上下文的消息类型
 *
 * 标签被移入 / 移出分组、或在窗口间移动后，其 groupId / windowId 会变化，
 * background 监听到后把新的上下文推给对应标签，让页面补丁通道的规则过滤保持实时。
 */
export const RUNTIME_MSG_SCOPE_CONTEXT_CHANGED = 'req-freedom:scope-context-changed';

/** Mock 响应的默认状态码 */
export const DEFAULT_MOCK_STATUS = 200;

/** 新建动态 Mock 时预填的函数示例（完整命名函数，运行时以 req 调用）。 */
export const DEFAULT_DYNAMIC_MOCK_FUNCTION_CODE = `function mock(req) {
  return {
    code: 0,
    data: {
      method: req.method,
      query: req.query,
      body: req.json ?? req.body,
    },
  };
}`;

/** 开启「基于真实响应」后预填的函数示例（运行时以 req、res 调用，res 为真实响应快照）。 */
export const DEFAULT_PASSTHROUGH_MOCK_FUNCTION_CODE = `function mock(req, res) {
  return {
    ...res.json,
    patchedBy: 'req-freedom',
  };
}`;

/** 新建 Mock 规则时采用的默认响应模式。 */
export const DEFAULT_MOCK_RESPONSE_MODE = MockResponseMode.Static;

/** 新建动态改请求体规则时预填的函数示例（完整命名函数，运行时以 req 调用）。 */
export const DEFAULT_DYNAMIC_REQUEST_BODY_FUNCTION_CODE = `function modify(req) {
  return {
    ...req.json,
    variables: {
      ...req.json?.variables,
      first: 100,
    },
  };
}`;

/** 新建改请求体规则时采用的默认内容来源。 */
export const DEFAULT_REQUEST_BODY_SOURCE_MODE = RequestBodySourceMode.Static;

/** 新建 Mock 规则时静态响应体的默认类型。 */
export const DEFAULT_MOCK_BODY_TYPE = MockBodyType.Json;

/** 各静态响应体类型对应的 Content-Type。 */
export const MOCK_BODY_TYPE_CONTENT_TYPES: Record<MockBodyType, string> = {
  [MockBodyType.Json]: 'application/json',
  [MockBodyType.Text]: 'text/plain',
  [MockBodyType.Html]: 'text/html',
  [MockBodyType.Xml]: 'application/xml',
  [MockBodyType.JavaScript]: 'text/javascript',
  [MockBodyType.Css]: 'text/css',
};

/** Mock 响应的默认 Content-Type（缺省 bodyType 与动态模式回落到此）。 */
export const DEFAULT_MOCK_CONTENT_TYPE = MOCK_BODY_TYPE_CONTENT_TYPES[DEFAULT_MOCK_BODY_TYPE];

/**
 * 单个内置动态变量的展示元数据，供编辑器列出与插入占位符。
 *
 * label / description 为语言无关的展示文案，由使用方（UI 层）按 i18n key 翻译，
 * key 固定为 `dynamicVariable.<name>.label` / `dynamicVariable.<name>.description`。
 */
export interface DynamicVariableMeta {
  /** 变量名 */
  name: DynamicVariableName;
  /** 可直接复制使用的占位符示例（带参数变量含默认参数） */
  placeholder: string;
  /** 一个示例输出值，帮助用户预期结果（数值 / 时间戳等，语言无关，无需翻译） */
  example: string;
}

/**
 * 内置动态变量清单（编辑器据此列出可用变量并支持一键复制占位符）。
 *
 * 顺序即展示顺序：无参数的常用变量在前，带参数的在后。
 */
export const DYNAMIC_VARIABLES: readonly DynamicVariableMeta[] = [
  { name: DynamicVariableName.Uuid, placeholder: '{{uuid}}', example: '3f9a1c7e-9b2d-4e1a-8c7f-2b6d0a5e4c31' },
  { name: DynamicVariableName.Timestamp, placeholder: '{{timestamp}}', example: '1753228800' },
  { name: DynamicVariableName.TimestampMs, placeholder: '{{timestampMs}}', example: '1753228800123' },
  { name: DynamicVariableName.IsoTime, placeholder: '{{isoTime}}', example: '2026-07-23T00:00:00.000Z' },
  { name: DynamicVariableName.RandomFloat, placeholder: '{{randomFloat}}', example: '0.6273481902' },
  { name: DynamicVariableName.RandomInt, placeholder: '{{randomInt(1,100)}}', example: '42' },
  { name: DynamicVariableName.RandomString, placeholder: '{{randomString(8)}}', example: 'a1B2c3D4' },
];

/** 单个网络档位的传输参数 */
export interface NetworkThrottleSettings {
  /** 往返延迟（毫秒） */
  latencyMs: number;
  /** 下行带宽（千比特/秒） */
  downloadKbps: number;
  /** 上行带宽（千比特/秒） */
  uploadKbps: number;
}

/** 网络档位的默认参数；Custom 由用户在规则中单独填写。 */
export const NETWORK_THROTTLE_PRESET_SETTINGS: Readonly<
  Record<Exclude<NetworkThrottlePreset, NetworkThrottlePreset.Custom>, NetworkThrottleSettings>
> = {
  [NetworkThrottlePreset.Fast3G]: { latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 },
  [NetworkThrottlePreset.Slow3G]: { latencyMs: 400, downloadKbps: 400, uploadKbps: 400 },
};

/** 新建网络限速规则时采用的默认档位。 */
export const DEFAULT_NETWORK_THROTTLE_PRESET = NetworkThrottlePreset.Fast3G;

/** 每字节包含的位数。 */
export const BITS_PER_BYTE = 8;

/** 每千比特包含的比特数。 */
export const BITS_PER_KILOBIT = 1000;

/** 限速配置面向用户展示的带宽单位，与 Chrome Network 面板保持一致。 */
export const NETWORK_SPEED_DISPLAY_UNIT = 'kB/s';

/**
 * 将内部使用的千比特每秒转换为用户可见的千字节每秒。
 * @param kbps 千比特每秒（Kbps）
 * @returns 千字节每秒（kB/s）
 */
export function kilobitsPerSecondToKilobytesPerSecond(kbps: number): number {
  return kbps / BITS_PER_BYTE;
}

/**
 * 将用户输入的千字节每秒转换为内部使用的千比特每秒。
 * @param kilobytesPerSecond 千字节每秒（kB/s）
 * @returns 千比特每秒（Kbps）
 */
export function kilobytesPerSecondToKilobitsPerSecond(kilobytesPerSecond: number): number {
  return kilobytesPerSecond * BITS_PER_BYTE;
}

/**
 * declarativeNetRequest 允许对「请求头」执行 append 操作的白名单（全部小写）
 *
 * Chrome 规定：只有这些天然可多值的请求头才能用 append 追加，
 * 其余自定义头（如 X-AA）用 append 会被静默忽略，必须改用 set。
 * 参考：https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-HeaderInfo
 */
export const APPENDABLE_REQUEST_HEADERS: readonly string[] = [
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
];

/**
 * 判断某个请求头是否允许 append（大小写不敏感）
 * @param header 请求头名称
 * @returns 该请求头是否在 append 白名单内
 */
export function isAppendableRequestHeader(header: string): boolean {
  return APPENDABLE_REQUEST_HEADERS.includes(header.trim().toLowerCase());
}
