import type { Browser } from 'wxt/browser';

/** DNR 规则条件类型别名，简化书写。 */
type DnrCondition = Browser.declarativeNetRequest.RuleCondition;

/** 一次 DNR 命中判定的输入请求。 */
export interface DnrMatchRequest {
  /** 完整请求 URL。 */
  url: string;
  /** 请求方法；不传表示不校验方法条件（只想验 URL 模式时使用）。 */
  method?: string;
}

/**
 * DNR `urlFilter` 中分隔符 `^` 对应的字符类。
 *
 * 分隔符指「字母、数字、`_`、`-`、`.`、`%` 之外的任意字符」，并且 URL 末尾也算一个分隔符。
 */
const SEPARATOR_PATTERN = '(?:[^a-zA-Z0-9_\\-.%]|$)';

/**
 * 转义正则元字符，使其按字面量参与匹配。
 * @param value 原始文本
 * @returns 转义后的文本
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 DNR 的 `urlFilter` 表达式编译为等价正则。
 *
 * 覆盖 urlFilter 的全部语法：`*` 通配任意字符，`^` 匹配分隔符，`|` 锚定 URL 首尾，
 * 开头的 `||` 锚定域名（可跨子域）。未加锚定时是**子串**匹配——这正是它与
 * `core.matchUrl` 语义最容易分歧的地方（后者对通配模式首尾锚定）。
 * @param urlFilter DNR urlFilter 表达式
 * @returns 等价正则；默认大小写不敏感，与 `isUrlFilterCaseSensitive` 缺省值一致
 */
function compileUrlFilter(urlFilter: string): RegExp {
  /** 是否为域名锚定（`||` 开头）。 */
  const domainAnchored = urlFilter.startsWith('||');
  /** 是否锚定 URL 开头（单个 `|` 开头）。 */
  const startAnchored = !domainAnchored && urlFilter.startsWith('|');
  /** 是否锚定 URL 结尾；单独一个 `|` 只作开头锚定，不重复消费。 */
  const endAnchored = urlFilter.endsWith('|') && urlFilter.length > 1;
  /** 去掉锚定符后的模式主体。 */
  const body = urlFilter.slice(domainAnchored ? 2 : startAnchored ? 1 : 0, endAnchored ? -1 : undefined);
  /** 主体逐字符转义后，再把 `*` 与 `^` 还原为各自的正则语义。 */
  const compiledBody = escapeRegExp(body)
    .replace(/\\\^/g, SEPARATOR_PATTERN)
    .replace(/\*/g, '.*');
  /** 域名锚定的前缀：scheme 之后、可选的子域之后开始匹配。 */
  const prefix = domainAnchored
    ? '^[a-zA-Z][a-zA-Z0-9+.\\-]*://(?:[^/?#]*\\.)?'
    : startAnchored
      ? '^'
      : '';
  return new RegExp(`${prefix}${compiledBody}${endAnchored ? '$' : ''}`, 'i');
}

/** 已编译 urlFilter 的缓存，避免同一模式在输入过程中被反复编译。 */
const urlFilterCache = new Map<string, RegExp>();

/**
 * 取得 urlFilter 对应的已编译正则，未命中缓存时编译一次。
 * @param urlFilter DNR urlFilter 表达式
 * @returns 编译好的正则
 */
function getUrlFilterRegExp(urlFilter: string): RegExp {
  /** 缓存中已有的编译结果。 */
  const cached = urlFilterCache.get(urlFilter);
  if (cached) {
    return cached;
  }
  /** 本次编译结果。 */
  const compiled = compileUrlFilter(urlFilter);
  urlFilterCache.set(urlFilter, compiled);
  return compiled;
}

/**
 * 判断请求是否命中一条 DNR 条件。
 *
 * 这是网络层行为的**同语义复刻**，用于在界面上如实预览 DNR 通道的命中结果；
 * `core.matchUrl` 是页面补丁通道的语义，两者对同一条规则可能给出不同答案
 * （见 `dnr-match-parity.test.ts` 钉住的已知偏差），因此按通道选择求值器。
 *
 * 未覆盖的条件：`tabIds`（作用域，需运行时标签上下文）与资源类型——它们不由本函数判定。
 * @param condition DNR 规则条件（由 `toDnrCondition` 编译得到）
 * @param request 待判定的请求
 * @returns 网络层是否会认为该请求命中
 */
export function matchDnrCondition(condition: DnrCondition, request: DnrMatchRequest): boolean {
  const { urlFilter, regexFilter, requestMethods } = condition;
  // 方法未指定时跳过该条件：气泡只验 URL 模式，不引入方法输入
  if (requestMethods && requestMethods.length > 0 && request.method !== undefined
    && !requestMethods.includes(request.method.toLowerCase() as Browser.declarativeNetRequest.RequestMethod)) {
    return false;
  }
  if (regexFilter !== undefined) {
    try {
      // DNR 的 regexFilter 默认同样不区分大小写；语法非法时浏览器会拒绝注册，此处按不命中处理
      return new RegExp(regexFilter, 'i').test(request.url);
    } catch {
      return false;
    }
  }
  return urlFilter !== undefined && getUrlFilterRegExp(urlFilter).test(request.url);
}
