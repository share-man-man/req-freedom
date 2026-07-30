import { describe, expect, it } from 'vitest';
import type { Rule } from '@req-freedom/shared';
import { HttpMethod, MatchType, RuleActionType, RuleExecutionChannel } from '@req-freedom/shared';
import { findMatchedRules } from './engine';

/**
 * 构造一条用于匹配测试的规则。
 * @param id 规则 ID
 * @param matchType 匹配方式
 * @param pattern 匹配模式
 * @param overrides 需要覆盖的规则字段
 * @returns 字段完整的业务规则
 */
function rule(
  id: string,
  matchType: MatchType,
  pattern: string,
  overrides: Partial<Rule> = {},
): Rule {
  return {
    id,
    name: id,
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType,
    pattern,
    methods: [] as HttpMethod[],
    actions: [{ type: RuleActionType.Block }],
    ...overrides,
  } as Rule;
}

/**
 * 断言某条规则是否命中给定请求。
 * @param target 待测规则
 * @param url 完整请求 URL
 * @param method 请求方法
 * @returns 是否命中
 */
function matches(target: Rule, url: string, method = 'GET'): boolean {
  return findMatchedRules(url, method, [target]).length > 0;
}

describe('findMatchedRules', () => {
  it('Contains 按子串匹配', () => {
    const target = rule('a', MatchType.Contains, '/api/users');

    expect(matches(target, 'https://x.com/api/users/1')).toBe(true);
    expect(matches(target, 'https://x.com/api/orders')).toBe(false);
  });

  it('Equals 要求完全相等', () => {
    const target = rule('a', MatchType.Equals, 'https://x.com/api');

    expect(matches(target, 'https://x.com/api')).toBe(true);
    expect(matches(target, 'https://x.com/api?q=1')).toBe(false);
  });

  it('Wildcard 首尾锚定，* 匹配任意字符', () => {
    const target = rule('a', MatchType.Wildcard, 'https://x.com/api/*');

    expect(matches(target, 'https://x.com/api/users')).toBe(true);
    expect(matches(target, 'https://y.com/?next=https://x.com/api/users')).toBe(false);
  });

  it('Regex 非法时静默不匹配而非抛错', () => {
    const target = rule('a', MatchType.Regex, '([');

    expect(() => matches(target, 'https://x.com/api')).not.toThrow();
    expect(matches(target, 'https://x.com/api')).toBe(false);
  });

  it('methods 为空数组表示不限方法', () => {
    const target = rule('a', MatchType.Contains, '/api');

    for (const method of ['GET', 'POST', 'DELETE']) {
      expect(matches(target, 'https://x.com/api', method)).toBe(true);
    }
  });

  it('方法比较大小写不敏感', () => {
    const target = rule('a', MatchType.Contains, '/api', { methods: [HttpMethod.Post] });

    expect(matches(target, 'https://x.com/api', 'post')).toBe(true);
    expect(matches(target, 'https://x.com/api', 'POST')).toBe(true);
    expect(matches(target, 'https://x.com/api', 'get')).toBe(false);
  });

  it('停用的规则不参与匹配', () => {
    const target = rule('a', MatchType.Contains, '/api', { enabled: false });

    expect(matches(target, 'https://x.com/api')).toBe(false);
  });

  it('保持传入顺序返回全部命中规则', () => {
    const first = rule('first', MatchType.Contains, '/api');
    const second = rule('second', MatchType.Contains, '/api');

    expect(findMatchedRules('https://x.com/api', 'GET', [first, second]).map((item) => item.id))
      .toEqual(['first', 'second']);
  });
});

// 正则按模式缓存以避免逐请求重复编译，以下用例守护缓存不改变匹配语义。
describe('正则缓存', () => {
  it('同一模式重复匹配结果稳定', () => {
    const wildcard = rule('wildcard', MatchType.Wildcard, 'https://x.com/api/*');

    expect(matches(wildcard, 'https://x.com/api/a')).toBe(true);
    expect(matches(wildcard, 'https://y.com/api/a')).toBe(false);
    expect(matches(wildcard, 'https://x.com/api/b')).toBe(true);
  });

  it('非法正则重复匹配始终不命中', () => {
    const invalid = rule('invalid', MatchType.Regex, '(');

    expect(matches(invalid, 'https://x.com/(')).toBe(false);
    expect(matches(invalid, 'https://x.com/(')).toBe(false);
  });

  it('Wildcard 与 Regex 使用同一模式字符串时互不串用', () => {
    /** 通配符下 `.` 是字面量，正则下 `.` 匹配任意字符。 */
    const pattern = 'https://x.com/a.b';

    expect(matches(rule('w', MatchType.Wildcard, pattern), 'https://x.com/aXb')).toBe(false);
    expect(matches(rule('r', MatchType.Regex, pattern), 'https://x.com/aXb')).toBe(true);
    expect(matches(rule('w2', MatchType.Wildcard, pattern), 'https://x.com/a.b')).toBe(true);
  });
});
