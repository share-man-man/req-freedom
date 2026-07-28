import { describe, expect, it, vi } from 'vitest';
import type { Rule } from '@req-freedom/shared';

// toDnrRules 只用到 declarativeNetRequest 上的几个枚举常量，在 node 环境下补齐即可，
// 无需真实浏览器：本测试关心的是编译出的 condition，而不是 action 的取值。
vi.mock('wxt/browser', () => ({
  browser: {
    declarativeNetRequest: {
      RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { APPEND: 'append', REMOVE: 'remove', SET: 'set' },
    },
  },
}));
import {
  HttpMethod,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import { findMatchedRules } from '@req-freedom/core';
import { toDnrRules } from './dnr';

/**
 * 这组测试守护本次重构接受的核心取舍：DNR 命中统计是「预测」而非「事实」。
 *
 * 网络层真正执行的是 `toDnrRules` 编译出的 condition，而统计用的是 `core.findMatchedRules`。
 * 两者一旦语义不一致，popup 显示的命中就会和实际行为对不上。这里用一个最小的 DNR
 * condition 求值器把二者放在同一组 URL 上对比，并把已知的不一致显式钉住。
 */

/**
 * 求值 DNR urlFilter，仅覆盖 `toCondition` 会生成的构造。
 *
 * DNR 的 urlFilter 是**子串**匹配：`*` 为通配符，首尾的 `|` 表示锚定。
 * 默认大小写不敏感，这里按默认行为实现。
 * @param urlFilter DNR urlFilter 表达式
 * @param url 完整请求 URL
 * @returns DNR 是否会认为该 URL 命中
 */
function matchesUrlFilter(urlFilter: string, url: string): boolean {
  /** 是否要求从 URL 开头匹配。 */
  const anchoredStart = urlFilter.startsWith('|');
  /** 是否要求匹配到 URL 结尾。 */
  const anchoredEnd = urlFilter.endsWith('|') && urlFilter.length > 1;
  /** 去掉锚定符后的模式主体。 */
  const body = urlFilter.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  /** 把 `*` 还原为正则通配后的模式。 */
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(
    `${anchoredStart ? '^' : ''}${escaped}${anchoredEnd ? '$' : ''}`,
    'i',
  ).test(url);
}

/**
 * 判断编译出的 DNR 规则是否会命中给定请求。
 * @param rule 业务规则
 * @param url 完整请求 URL
 * @param method 请求方法
 * @returns DNR 网络层是否会命中
 */
function dnrWouldMatch(rule: Rule, url: string, method: string): boolean {
  /** 该规则编译出的全部 DNR 规则；取第一条的 condition 即可，同规则共用 condition。 */
  const [compiled] = toDnrRules(rule, 1000);
  if (!compiled) {
    return false;
  }
  const { urlFilter, regexFilter, requestMethods } = compiled.condition;
  if (requestMethods && !requestMethods.includes(method.toLowerCase() as never)) {
    return false;
  }
  if (regexFilter !== undefined) {
    return new RegExp(regexFilter).test(url);
  }
  return urlFilter !== undefined && matchesUrlFilter(urlFilter, url);
}

/**
 * 构造一条只含 Block 动作的 DNR 规则。
 * @param matchType 匹配方式
 * @param pattern 匹配模式
 * @param methods 限定方法
 * @returns 字段完整的业务规则
 */
function blockRule(matchType: MatchType, pattern: string, methods: HttpMethod[] = []): Rule {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType,
    pattern,
    methods,
    actions: [{ type: RuleActionType.Block }],
  } as Rule;
}

/**
 * 统计侧（core）是否认为命中。
 * @param rule 业务规则
 * @param url 完整请求 URL
 * @param method 请求方法
 * @returns core 匹配器是否命中
 */
function coreWouldMatch(rule: Rule, url: string, method: string): boolean {
  return findMatchedRules(url, method, [rule]).length > 0;
}

describe('DNR 执行与命中统计的语义一致性', () => {
  it('Contains：与 DNR 子串匹配一致', () => {
    const rule = blockRule(MatchType.Contains, '/api/users');

    for (const url of [
      'https://a.com/api/users',
      'https://a.com/api/users/1',
      'https://a.com/v2/api/users?x=1',
      'https://a.com/api/other',
    ]) {
      expect(coreWouldMatch(rule, url, 'GET')).toBe(dnrWouldMatch(rule, url, 'GET'));
    }
  });

  it('Equals：与 DNR 首尾锚定一致', () => {
    const rule = blockRule(MatchType.Equals, 'https://a.com/api');

    for (const url of ['https://a.com/api', 'https://a.com/api/1', 'https://b.com/api']) {
      expect(coreWouldMatch(rule, url, 'GET')).toBe(dnrWouldMatch(rule, url, 'GET'));
    }
  });

  it('Regex：与 DNR regexFilter 一致', () => {
    const rule = blockRule(MatchType.Regex, '^https://a\\.com/api/\\d+$');

    for (const url of ['https://a.com/api/1', 'https://a.com/api/x', 'https://a.com/api/1/2']) {
      expect(coreWouldMatch(rule, url, 'GET')).toBe(dnrWouldMatch(rule, url, 'GET'));
    }
  });

  it('方法过滤：与 DNR requestMethods 一致', () => {
    const rule = blockRule(MatchType.Contains, '/api', [HttpMethod.Post]);

    for (const method of ['GET', 'POST', 'PUT']) {
      expect(coreWouldMatch(rule, 'https://a.com/api', method))
        .toBe(dnrWouldMatch(rule, 'https://a.com/api', method));
    }
  });

  // 已知不一致：core 的 Wildcard 是首尾锚定的正则，而它被编译成未锚定的 urlFilter（子串匹配）。
  // 结果是 DNR 实际拦截的范围比统计显示的更宽 —— 统计会少报，但不会错误归因。
  // 这是重构前既有的编译语义，修改它会改变规则的实际拦截行为，故此处只钉住现状。
  it('Wildcard：DNR 比统计更宽松（已知不一致，故意钉住）', () => {
    const rule = blockRule(MatchType.Wildcard, 'https://a.com/api/*');
    /** 前缀不在 URL 开头的场景。 */
    const embedded = 'https://evil.com/?next=https://a.com/api/x';

    expect(coreWouldMatch(rule, 'https://a.com/api/x', 'GET')).toBe(true);
    expect(dnrWouldMatch(rule, 'https://a.com/api/x', 'GET')).toBe(true);

    expect(coreWouldMatch(rule, embedded, 'GET')).toBe(false);
    expect(dnrWouldMatch(rule, embedded, 'GET')).toBe(true);
  });

  it('Wildcard：无通配符时 DNR 仍按子串匹配（已知不一致，故意钉住）', () => {
    const rule = blockRule(MatchType.Wildcard, 'https://a.com/api');

    expect(coreWouldMatch(rule, 'https://a.com/api/sub', 'GET')).toBe(false);
    expect(dnrWouldMatch(rule, 'https://a.com/api/sub', 'GET')).toBe(true);
  });
});
