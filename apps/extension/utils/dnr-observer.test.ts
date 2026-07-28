import { describe, expect, it } from 'vitest';
import type { Rule } from '@req-freedom/shared';
import {
  HttpMethod,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
  RuleScopeType,
} from '@req-freedom/shared';
import { toRuleHits } from './dnr-observer';
import type { ActiveDnrRuleSnapshot } from './active-rules-cache';

/**
 * 构造一条 DNR 通道的测试规则。
 * @param id 规则 ID
 * @param actions 规则动作
 * @param overrides 需要覆盖的规则字段
 * @returns 字段完整的业务规则
 */
function rule(id: string, actions: unknown[], overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    name: id,
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType: MatchType.Contains,
    pattern: '/api',
    methods: [] as HttpMethod[],
    actions,
    ...overrides,
  } as Rule;
}

/**
 * 构造观测快照。
 * @param rules DNR 通道生效规则
 * @param tabIdsByRuleId 作用域规则解析出的目标 tabId
 * @returns 观测快照
 */
function snapshot(
  rules: Rule[],
  tabIdsByRuleId: Map<string, number[]> = new Map(),
): ActiveDnrRuleSnapshot {
  return { rules, tabIdsByRuleId };
}

/** 一条同时包含重定向与 Header 改写的规则。 */
const TWO_ACTION_RULE = rule('two', [
  { type: RuleActionType.Redirect, redirectUrl: 'https://y/api' },
  {
    type: RuleActionType.ModifyHeaders,
    headers: [{ target: 'request', operation: 'set', header: 'X-A', value: '1' }],
  },
]);

describe('toRuleHits', () => {
  it('一条规则的每个 DNR 动作各记一条命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api/users', method: 'GET', tabId: 7 },
      snapshot([TWO_ACTION_RULE]),
      99,
    );

    expect(hits).toEqual([
      { ruleId: 'two', action: RuleActionType.Redirect, url: 'https://x/api/users', method: 'GET', at: 99 },
      { ruleId: 'two', action: RuleActionType.ModifyHeaders, url: 'https://x/api/users', method: 'GET', at: 99 },
    ]);
  });

  it('空 Header 列表的改写动作不产生命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api', method: 'GET', tabId: 1 },
      snapshot([rule('empty', [{ type: RuleActionType.ModifyHeaders, headers: [] }])]),
      1,
    );

    expect(hits).toEqual([]);
  });

  it('页面补丁专属动作不计入 DNR 通道命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api', method: 'GET', tabId: 1 },
      snapshot([rule('page', [{ type: RuleActionType.Delay, preset: 'fast-3g' }])]),
      1,
    );

    expect(hits).toEqual([]);
  });

  it('方法不匹配时不产生命中', () => {
    /** 只对 POST 生效的拦截规则。 */
    const postOnly = rule('post-only', [{ type: RuleActionType.Block }], {
      methods: [HttpMethod.Post],
    });

    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 1 }, snapshot([postOnly]), 1))
      .toEqual([]);
    expect(toRuleHits({ url: 'https://x/api', method: 'POST', tabId: 1 }, snapshot([postOnly]), 1))
      .toHaveLength(1);
  });

  it('作用域规则只在解析出的标签页内命中', () => {
    /** 限定到 tab 42 的拦截规则。 */
    const scoped = rule('scoped', [{ type: RuleActionType.Block }], {
      scope: { type: RuleScopeType.Tab, targets: [{ id: 42, label: 'x' }] },
    });
    const scopedSnapshot = snapshot([scoped], new Map([['scoped', [42]]]));

    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 42 }, scopedSnapshot, 1))
      .toHaveLength(1);
    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 9 }, scopedSnapshot, 1))
      .toEqual([]);
  });

  it('非标签页请求不记录命中', () => {
    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: -1 }, snapshot([TWO_ACTION_RULE]), 1))
      .toEqual([]);
  });
});
