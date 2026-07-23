import { browser, type Browser } from 'wxt/browser';
import type { Rule } from '@req-freedom/shared';
import {
  HeaderOperation,
  HeaderTarget,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';

/** DNR 规则类型别名，简化书写。 */
type DnrRule = Browser.declarativeNetRequest.Rule;

/**
 * 把规则的 URL 匹配配置转换为 DNR 的 condition。
 * @param rule 业务规则
 * @returns DNR condition 对象
 */
function toCondition(rule: Rule): Browser.declarativeNetRequest.RuleCondition {
  /** 将大写 HTTP 方法转成 DNR 所需的小写格式。 */
  const requestMethods = rule.methods.map((method) => method.toLowerCase() as Browser.declarativeNetRequest.RequestMethod);
  switch (rule.matchType) {
    case MatchType.Regex:
      return { regexFilter: rule.pattern, ...(requestMethods.length ? { requestMethods } : {}) };
    case MatchType.Equals:
      return { urlFilter: `|${rule.pattern}|`, ...(requestMethods.length ? { requestMethods } : {}) };
    case MatchType.Wildcard:
    case MatchType.Contains:
    default:
      return { urlFilter: rule.pattern, ...(requestMethods.length ? { requestMethods } : {}) };
  }
}

/**
 * 把业务侧 Header 操作枚举转换为 DNR 的 HeaderOperation。
 * @param operation 业务侧操作枚举
 * @returns DNR 的 HeaderOperation
 */
function toDnrHeaderOperation(operation: HeaderOperation): Browser.declarativeNetRequest.HeaderOperation {
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
 * 把一条统一 DNR 规则编译成一组 Chrome DNR 规则。
 * @param rule 业务规则
 * @param firstDnrId 该规则可使用的第一个 DNR 数字 ID
 * @param tabIds 作用域解析出的目标 tabId 列表；传入非空数组时以 session 规则语义附加 tabIds 条件，
 *   把规则限定到这些标签页（仅 declarativeNetRequest session 规则支持 tabIds 条件）
 * @returns 每个可执行动作对应的一条 DNR 规则
 */
export function toDnrRules(rule: Rule, firstDnrId: number, tabIds?: number[]): DnrRule[] {
  if (rule.channel !== RuleExecutionChannel.Dnr) {
    return [];
  }
  /** 规则共有的匹配条件；作用域规则附加 tabIds 把生效范围限定到目标标签页。 */
  const condition: Browser.declarativeNetRequest.RuleCondition =
    tabIds && tabIds.length > 0 ? { ...toCondition(rule), tabIds } : toCondition(rule);
  /** 编译出的 DNR 规则集合。 */
  const dnrRules: DnrRule[] = [];
  for (const action of rule.actions) {
    /** 每个动作都需要独立的 DNR ID。 */
    const id = firstDnrId + dnrRules.length;
    switch (action.type) {
      case RuleActionType.Block:
        dnrRules.push({ id, condition, action: { type: browser.declarativeNetRequest.RuleActionType.BLOCK } });
        break;
      case RuleActionType.Redirect:
        dnrRules.push({
          id,
          condition,
          action: {
            type: browser.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect:
              rule.matchType === MatchType.Regex
                ? { regexSubstitution: action.redirectUrl }
                : { url: action.redirectUrl },
          },
        });
        break;
      case RuleActionType.InjectParams:
        dnrRules.push({
          id,
          condition,
          action: {
            type: browser.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: {
              transform: {
                queryTransform: {
                  addOrReplaceParams: Object.entries(action.params).map(([key, value]) => ({ key, value })),
                },
              },
            },
          },
        });
        break;
      case RuleActionType.ModifyHeaders: {
        /** 请求头修改项。 */
        const requestHeaders = action.headers
          .filter((item) => item.target === HeaderTarget.Request)
          .map((item) => ({ header: item.header, operation: toDnrHeaderOperation(item.operation), value: item.value }));
        /** 响应头修改项。 */
        const responseHeaders = action.headers
          .filter((item) => item.target === HeaderTarget.Response)
          .map((item) => ({ header: item.header, operation: toDnrHeaderOperation(item.operation), value: item.value }));
        if (requestHeaders.length || responseHeaders.length) {
          dnrRules.push({
            id,
            condition,
            action: {
              type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              ...(requestHeaders.length ? { requestHeaders } : {}),
              ...(responseHeaders.length ? { responseHeaders } : {}),
            },
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return dnrRules;
}
