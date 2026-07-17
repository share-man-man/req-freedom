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
