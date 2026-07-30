import { describe, expect, it } from 'vitest';
import { RuleActionType, RuleHitOutcome, RuleHitSkipReason } from '@req-freedom/shared';
import type { RuleHit } from '@req-freedom/shared';
import {
  appendHits,
  collectHitRuleIds,
  createTabHitLog,
  mergeRestoredHits,
  parseHits,
  summarizeHits,
  type TabHitLog,
} from './rule-hit';

/**
 * 构造一条已执行的命中记录。
 * @param ruleId 业务规则 ID
 * @param action 动作类型
 * @returns 字段完整的命中记录
 */
function hit(ruleId: string, action: RuleActionType = RuleActionType.Block): RuleHit {
  return {
    ruleId,
    action,
    url: 'https://example.com/api',
    method: 'GET',
    at: 1,
    outcome: RuleHitOutcome.Applied,
  };
}

/**
 * 构造一条「匹配上但未应用」的记录。
 * @param ruleId 业务规则 ID
 * @param reason 无法应用的原因
 * @returns 字段完整的命中记录
 */
function skipped(
  ruleId: string,
  reason: RuleHitSkipReason = RuleHitSkipReason.OpaqueResponse,
): RuleHit {
  return { ...hit(ruleId), outcome: RuleHitOutcome.Skipped, reason };
}

describe('rule-hit', () => {
  it('超出上限时丢弃最早的记录并标记截断', () => {
    /** 容量上限为 3 的日志。 */
    const log = appendHits(
      createTabHitLog(),
      [hit('a'), hit('b'), hit('c'), hit('d')],
      3,
    );

    expect(log.hits.map((item) => item.ruleId)).toEqual(['b', 'c', 'd']);
    expect(log.truncated).toBe(true);
  });

  it('未超出上限时不标记截断', () => {
    const log = appendHits(createTabHitLog(), [hit('a'), hit('b')], 3);

    expect(log.truncated).toBe(false);
  });

  it('摘要按规则去重并保持首次命中顺序', () => {
    const log = appendHits(createTabHitLog(), [hit('b'), hit('a'), hit('b')]);

    expect(collectHitRuleIds(log.hits)).toEqual(['b', 'a']);
    expect(summarizeHits(log)).toEqual({
      ruleIds: ['b', 'a'],
      skippedRuleIds: {},
      truncated: false,
    });
    expect(summarizeHits(undefined)).toEqual({
      ruleIds: [],
      skippedRuleIds: {},
      truncated: false,
    });
  });

  it('未应用的记录不算命中，单列为跳过并带上原因', () => {
    const log = appendHits(createTabHitLog(), [
      skipped('a', RuleHitSkipReason.OpaqueResponse),
      skipped('b', RuleHitSkipReason.SyncXhr),
    ]);

    expect(summarizeHits(log)).toEqual({
      ruleIds: [],
      skippedRuleIds: {
        a: RuleHitSkipReason.OpaqueResponse,
        b: RuleHitSkipReason.SyncXhr,
      },
      truncated: false,
    });
  });

  it('同一规则既生效过又被跳过时只算生效', () => {
    // 界面上一条规则只有一个状态位，「它确实生效过」是更重要的事实。
    const log = appendHits(createTabHitLog(), [skipped('a'), hit('a')]);

    expect(summarizeHits(log)).toEqual({
      ruleIds: ['a'],
      skippedRuleIds: {},
      truncated: false,
    });
  });

  it('同一规则的多个动作在摘要中只出现一次', () => {
    /** 同一规则的重定向与 Header 改写两个动作。 */
    const log = appendHits(createTabHitLog(), [
      hit('a', RuleActionType.Redirect),
      hit('a', RuleActionType.ModifyHeaders),
    ]);

    expect(summarizeHits(log).ruleIds).toEqual(['a']);
  });

  it('拒绝字段非法或动作类型未知的上报', () => {
    /** 合法的已执行记录，用作对照。 */
    const valid = {
      ruleId: 'a',
      action: RuleActionType.Delay,
      url: 'https://x/',
      method: 'POST',
      at: 5,
      outcome: RuleHitOutcome.Applied,
    };

    expect(parseHits([
      valid,
      { ...valid, ruleId: '' },
      { ...valid, ruleId: 'b', action: 'not-a-real-action' },
      { ...valid, ruleId: 'd', url: 'x'.repeat(4096) },
      // 结果字段缺失或取值未知
      { ruleId: 'e', action: RuleActionType.Block, url: 'https://x/', method: 'GET' },
      { ...valid, ruleId: 'f', outcome: 'not-a-real-outcome' },
      // 跳过必须带合法原因，否则界面无从解释
      { ...valid, ruleId: 'g', outcome: RuleHitOutcome.Skipped },
      { ...valid, ruleId: 'h', outcome: RuleHitOutcome.Skipped, reason: 'not-a-real-reason' },
      'not-an-object',
    ], 5)).toEqual([valid]);
    expect(parseHits('not-an-array', 5)).toEqual([]);
  });

  it('记录时间取接收时刻，不采信页面上报的值', () => {
    /** 谎报了一个远期时间的上报：它会让该标签页在活跃度排序里永远排在最前。 */
    const forged = {
      ruleId: 'a',
      action: RuleActionType.Block,
      url: 'https://x/',
      method: 'GET',
      at: Number.MAX_SAFE_INTEGER,
      outcome: RuleHitOutcome.Applied,
    };

    expect(parseHits([forged], 42)).toEqual([{ ...forged, at: 42 }]);
  });

  it('缺少 at 字段的上报照常接受', () => {
    /** 页面侧不必自报时间，缺字段不算非法。 */
    const reported = {
      ruleId: 'a',
      action: RuleActionType.Block,
      url: 'https://x/',
      method: 'GET',
      outcome: RuleHitOutcome.Applied,
    };

    expect(parseHits([reported], 7)).toEqual([{ ...reported, at: 7 }]);
  });

  it('接受带合法原因的跳过记录', () => {
    /** 页面上下文上报的跳过记录。 */
    const reported = {
      ruleId: 'a',
      action: RuleActionType.MockResponse,
      url: 'https://x/',
      method: 'GET',
      at: 1,
      outcome: RuleHitOutcome.Skipped,
      reason: RuleHitSkipReason.OpaqueResponse,
    };

    expect(parseHits([reported], 1)).toEqual([reported]);
  });

  it('单条消息上报的命中数量受限', () => {
    /** 远超单条消息上限的上报。 */
    const flood = Array.from({ length: 500 }, () => ({
      ruleId: 'a',
      action: RuleActionType.Block,
      url: 'https://x/',
      method: 'GET',
      at: 1,
      outcome: RuleHitOutcome.Applied,
    }));

    expect(parseHits(flood, 1)).toHaveLength(100);
  });

  it('恢复镜像时不覆盖内存中已存在的标签页', () => {
    /** 重启后已经记录了新命中的内存日志。 */
    const current = new Map<number, TabHitLog>([
      [1, appendHits(createTabHitLog(), [hit('fresh')])],
    ]);
    /** 从 storage.session 镜像读回的旧日志。 */
    const restored: [number, TabHitLog][] = [
      [1, appendHits(createTabHitLog(), [hit('stale')])],
      [2, appendHits(createTabHitLog(), [hit('other')])],
    ];

    mergeRestoredHits(current, restored);

    expect(current.get(1)?.hits.map((item) => item.ruleId)).toEqual(['fresh']);
    expect(current.get(2)?.hits.map((item) => item.ruleId)).toEqual(['other']);
  });
});
