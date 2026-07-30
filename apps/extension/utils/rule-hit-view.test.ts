import { describe, expect, it } from 'vitest';
import { RuleActionType, RuleHitOutcome, RuleHitSkipReason } from '@req-freedom/shared';
import type { RuleHit } from '@req-freedom/shared';
import { countHitsByRule, EMPTY_HIT_LOG_FILTER, filterHits } from './rule-hit-view';

/**
 * 构造一条已执行的命中记录。
 * @param ruleId 业务规则 ID
 * @param overrides 需要覆盖的字段
 * @returns 字段完整的命中记录
 */
function hit(ruleId: string, overrides: Partial<RuleHit> = {}): RuleHit {
  return {
    ruleId,
    action: RuleActionType.Block,
    url: 'https://example.com/api/users',
    method: 'GET',
    at: 1,
    outcome: RuleHitOutcome.Applied,
    ...overrides,
  } as RuleHit;
}

/**
 * 构造一条「匹配上但未应用」的记录。
 * @param ruleId 业务规则 ID
 * @returns 字段完整的命中记录
 */
function skipped(ruleId: string): RuleHit {
  return {
    ...hit(ruleId),
    outcome: RuleHitOutcome.Skipped,
    reason: RuleHitSkipReason.SyncXhr,
  };
}

describe('filterHits', () => {
  it('无条件时原样返回并保持顺序', () => {
    /** 三条顺序固定的命中。 */
    const hits = [hit('a'), hit('b'), hit('c')];

    expect(filterHits(hits, EMPTY_HIT_LOG_FILTER).map((item) => item.ruleId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('按规则、动作与执行结果分别过滤', () => {
    /** 覆盖三个筛选维度的命中集合。 */
    const hits = [
      hit('a', { action: RuleActionType.Block }),
      hit('b', { action: RuleActionType.MockResponse }),
      skipped('b'),
    ];

    expect(filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, ruleId: 'b' })).toHaveLength(2);
    expect(
      filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, action: RuleActionType.MockResponse }),
    ).toHaveLength(1);
    expect(
      filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, outcome: RuleHitOutcome.Skipped }),
    ).toHaveLength(1);
  });

  it('关键词匹配 URL 与方法且大小写不敏感', () => {
    /** URL 与方法各不相同的命中集合。 */
    const hits = [
      hit('a', { url: 'https://example.com/api/users', method: 'GET' }),
      hit('b', { url: 'https://cdn.example.com/app.js', method: 'POST' }),
    ];

    expect(filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, keyword: 'CDN' })).toHaveLength(1);
    expect(filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, keyword: 'post' })).toHaveLength(1);
    expect(filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, keyword: '  ' })).toHaveLength(2);
  });

  it('关键词也匹配规则名称，规则已删除时只按请求字段匹配', () => {
    /** 一条仍存在的规则与一条已删除的规则。 */
    const hits = [hit('a'), hit('deleted')];

    expect(
      filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, keyword: '拦截广告' }, { a: '拦截广告' }),
    ).toEqual([hits[0]]);
    expect(
      filterHits(hits, { ...EMPTY_HIT_LOG_FILTER, keyword: 'users' }, { a: '拦截广告' }),
    ).toHaveLength(2);
  });

  it('多个条件同时生效时取交集', () => {
    /** 同一规则下动作不同的命中。 */
    const hits = [
      hit('a', { action: RuleActionType.Block }),
      hit('a', { action: RuleActionType.Redirect, url: 'https://example.com/track' }),
    ];

    expect(
      filterHits(hits, {
        ...EMPTY_HIT_LOG_FILTER,
        ruleId: 'a',
        action: RuleActionType.Redirect,
        keyword: 'track',
      }),
    ).toHaveLength(1);
  });
});

describe('countHitsByRule', () => {
  it('按命中总数倒序归并，并单独统计实际生效的条数', () => {
    /** 两条规则、总数不同的命中集合。 */
    const hits = [hit('a'), skipped('b'), hit('b'), hit('b')];

    expect(countHitsByRule(hits)).toEqual([
      { ruleId: 'b', total: 3, applied: 2 },
      { ruleId: 'a', total: 1, applied: 1 },
    ]);
  });

  it('总数相同时保持首次命中顺序', () => {
    /** 两条各命中一次的规则。 */
    const hits = [hit('first'), hit('second')];

    expect(countHitsByRule(hits).map((count) => count.ruleId)).toEqual(['first', 'second']);
  });

  it('空日志返回空统计', () => {
    expect(countHitsByRule([])).toEqual([]);
  });
});
