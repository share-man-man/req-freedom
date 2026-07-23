import { MockBodyType, MockResponseMode, NetworkThrottlePreset, RequestBodySourceMode } from './enums';

/** storage 中规则分组列表的键名（顶层文档模型：分组内嵌套规则） */
export const STORAGE_KEY_GROUPS = 'req-freedom:groups';

/** storage 中全局开关的键名 */
export const STORAGE_KEY_ENABLED = 'req-freedom:enabled';

/** 导入 / 导出文件当前使用的配置 schema 版本。 */
export const CONFIG_EXPORT_SCHEMA_VERSION = 2;

/** 导出配置文件的文件名固定前缀。 */
export const CONFIG_EXPORT_FILE_NAME_PREFIX = 'req-freedom-config';

/** 新建分组时的默认名称 */
export const DEFAULT_GROUP_NAME = '新建分组';

/** 尚无分组时，新建首条规则自动创建的分组名称 */
export const AUTO_DEFAULT_GROUP_NAME = '默认分组';

/** 页面内 postMessage 通信的来源标识（ISOLATED 内容脚本 -> MAIN world 注入脚本） */
export const PAGE_MESSAGE_SOURCE = 'req-freedom:bridge';

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
