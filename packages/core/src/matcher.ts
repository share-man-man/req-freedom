import { MatchType } from '@req-freedom/shared';

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
