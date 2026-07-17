/** storage 中规则列表的键名 */
export const STORAGE_KEY_RULES = 'req-freedom:rules';

/** storage 中全局开关的键名 */
export const STORAGE_KEY_ENABLED = 'req-freedom:enabled';

/** 页面内 postMessage 通信的来源标识（ISOLATED 内容脚本 -> MAIN world 注入脚本） */
export const PAGE_MESSAGE_SOURCE = 'req-freedom:bridge';

/** declarativeNetRequest 动态规则 ID 起始偏移，避免与其他来源的规则 ID 冲突 */
export const DNR_RULE_ID_OFFSET = 1000;

/** Mock 响应的默认状态码 */
export const DEFAULT_MOCK_STATUS = 200;

/** Mock 响应的默认 Content-Type */
export const DEFAULT_MOCK_CONTENT_TYPE = 'application/json';

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
