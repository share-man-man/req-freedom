import { browser, type Browser } from 'wxt/browser';
import type { Rule } from '@req-freedom/shared';
import { HeaderOperation, HeaderTarget, MatchType, RuleType } from '@req-freedom/shared';

/** DNR 规则类型别名，简化书写 */
type DnrRule = Browser.declarativeNetRequest.Rule;

/**
 * 把规则的 URL 匹配配置转换为 DNR 的 condition
 * @param rule 业务规则
 * @returns DNR condition 对象
 */
function toCondition(rule: Rule): Browser.declarativeNetRequest.RuleCondition {
  switch (rule.matchType) {
    case MatchType.Regex:
      return { regexFilter: rule.pattern };
    case MatchType.Equals:
      // |...| 是 DNR urlFilter 的首尾锚定语法，表示完全匹配
      return { urlFilter: `|${rule.pattern}|` };
    case MatchType.Wildcard:
    case MatchType.Contains:
    default:
      // urlFilter 天然支持子串与 * 通配符
      return { urlFilter: rule.pattern };
  }
}

/**
 * 把业务侧 Header 操作枚举转换为 DNR 的 HeaderOperation
 * @param operation 业务侧操作枚举
 * @returns DNR 的 HeaderOperation
 */
function toDnrHeaderOperation(
  operation: HeaderOperation,
): Browser.declarativeNetRequest.HeaderOperation {
  switch (operation) {
    case HeaderOperation.Append:
      return browser.declarativeNetRequest.HeaderOperation.APPEND;
    case HeaderOperation.Remove:
      return browser.declarativeNetRequest.HeaderOperation.REMOVE;
    case HeaderOperation.Set:
    default:
      return browser.declarativeNetRequest.HeaderOperation.SET;
  }
}

/**
 * 把单条业务规则转换为 DNR 动态规则
 *
 * 仅 Block / Redirect / InjectParams / ModifyHeaders 可由 DNR 承载；
 * Mock 与 Delay 由页面内 fetch/XHR 补丁实现，返回 null。
 * @param rule 业务规则
 * @param dnrId 分配给该条 DNR 规则的数字 ID
 * @returns DNR 规则；该类型不适用 DNR 时返回 null
 */
export function toDnrRule(rule: Rule, dnrId: number): DnrRule | null {
  /** 公共的 condition 部分 */
  const condition = toCondition(rule);

  switch (rule.type) {
    case RuleType.Block:
      return {
        id: dnrId,
        condition,
        action: { type: browser.declarativeNetRequest.RuleActionType.BLOCK },
      };
    case RuleType.Redirect:
      return {
        id: dnrId,
        condition,
        action: {
          type: browser.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect:
            rule.matchType === MatchType.Regex
              ? // 正则匹配时支持 \1 捕获组替换
                { regexSubstitution: rule.redirectUrl }
              : { url: rule.redirectUrl },
        },
      };
    case RuleType.InjectParams:
      return {
        id: dnrId,
        condition,
        action: {
          type: browser.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: {
            transform: {
              queryTransform: {
                addOrReplaceParams: Object.entries(rule.params).map(([key, value]) => ({
                  key,
                  value,
                })),
              },
            },
          },
        },
      };
    case RuleType.ModifyHeaders: {
      /** 请求头修改项 */
      const requestHeaders = rule.headers
        .filter((item) => item.target === HeaderTarget.Request)
        .map((item) => ({
          header: item.header,
          operation: toDnrHeaderOperation(item.operation),
          value: item.value,
        }));
      /** 响应头修改项 */
      const responseHeaders = rule.headers
        .filter((item) => item.target === HeaderTarget.Response)
        .map((item) => ({
          header: item.header,
          operation: toDnrHeaderOperation(item.operation),
          value: item.value,
        }));
      return {
        id: dnrId,
        condition,
        action: {
          type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          ...(requestHeaders.length > 0 ? { requestHeaders } : {}),
          ...(responseHeaders.length > 0 ? { responseHeaders } : {}),
        },
      };
    }
    // Mock 与延迟在页面内实现，不走 DNR
    case RuleType.MockResponse:
    case RuleType.Delay:
    default:
      return null;
  }
}
