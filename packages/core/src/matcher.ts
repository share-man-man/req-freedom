import { BodyMatchType, MatchType, RuleScopeType } from '@req-freedom/shared';
import type { BodyMatcher, RuleScope, ScopeContext } from '@req-freedom/shared';

/**
 * 将通配符模式转换为正则表达式（* 匹配任意长度字符，其余字符按字面量处理）
 * @param pattern 通配符模式，如 https://api.example.com/*
 * @returns 等价的正则表达式
 */
function wildcardToRegExp(pattern: string): RegExp {
  // 先转义正则元字符，再把转义后的 \* 还原为 .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * 判断 URL 是否命中给定的匹配模式
 * @param url 完整请求 URL
 * @param matchType 匹配方式
 * @param pattern 匹配模式
 * @returns 是否命中；正则语法非法时返回 false 而不是抛错
 */
export function matchUrl(url: string, matchType: MatchType, pattern: string): boolean {
  switch (matchType) {
    case MatchType.Contains:
      return url.includes(pattern);
    case MatchType.Equals:
      return url === pattern;
    case MatchType.Wildcard:
      return wildcardToRegExp(pattern).test(url);
    case MatchType.Regex:
      try {
        return new RegExp(pattern).test(url);
      } catch {
        // 用户输入的正则可能非法，静默降级为不匹配
        return false;
      }
    default:
      return false;
  }
}

/**
 * 从请求体文本中提取全部 GraphQL operationName
 *
 * 支持单个操作对象与批量数组两种形态；请求体非 JSON、或无 operationName 字段时返回空数组。
 * @param body 请求体文本
 * @returns 请求体中出现的 operationName 列表（去除非字符串项）
 */
function extractGraphQlOperationNames(body: string): string[] {
  /** 请求体解析出的 JSON 值。 */
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 非 JSON 请求体不可能是 GraphQL 操作，视为无操作名
    return [];
  }
  /** 待检查的操作对象列表：批量请求为数组，单请求包一层数组统一处理。 */
  const operations = Array.isArray(parsed) ? parsed : [parsed];
  return operations
    .map((operation) =>
      typeof operation === 'object' && operation !== null
        ? (operation as Record<string, unknown>).operationName
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
}

/**
 * 判断规则作用域是否命中给定的运行时上下文
 *
 * 缺省作用域或 AllTabs 恒命中；其余类型要求上下文中对应的 tab / window / group ID
 * 落在作用域目标集合内。上下文对应字段缺失（如尚未取得标签上下文）时，作用域规则一律不命中，
 * 保证「上下文未知」时不会让限定范围的规则误生效。
 * @param scope 规则作用域条件（缺省表示不限制）
 * @param context 当前标签的运行时上下文
 * @returns 是否命中作用域
 */
export function matchScope(scope: RuleScope | undefined, context: ScopeContext): boolean {
  if (!scope || scope.type === RuleScopeType.AllTabs) {
    return true;
  }
  /** 作用域目标对象的 ID 集合。 */
  const targetIds = scope.targets.map((target) => target.id);
  switch (scope.type) {
    case RuleScopeType.Tab:
      return context.tabId !== undefined && targetIds.includes(context.tabId);
    case RuleScopeType.Window:
      return context.windowId !== undefined && targetIds.includes(context.windowId);
    case RuleScopeType.TabGroup:
      return context.groupId !== undefined && targetIds.includes(context.groupId);
    default:
      return false;
  }
}

/**
 * 判断请求体是否命中给定的请求体匹配条件
 * @param matcher 请求体匹配条件
 * @param body 请求体文本（无法读取时传空串）
 * @returns 是否命中；正则语法非法时返回 false 而不是抛错
 */
export function matchRequestBody(matcher: BodyMatcher, body: string): boolean {
  switch (matcher.type) {
    case BodyMatchType.Contains:
      return body.includes(matcher.value);
    case BodyMatchType.Regex:
      try {
        return new RegExp(matcher.value).test(body);
      } catch {
        // 用户输入的正则可能非法，静默降级为不匹配
        return false;
      }
    case BodyMatchType.GraphQlOperation:
      return extractGraphQlOperationNames(body).includes(matcher.value);
    default:
      return false;
  }
}
