import { describe, expect, it } from 'vitest';
import { RuleActionType } from '@req-freedom/shared';
import type { RuleHit } from '@req-freedom/shared';
import {
  appendHits,
  countByRule,
  createTabHitLog,
  mergeRestoredHits,
  parseHits,
  summarizeHits,
  type TabHitLog,
} from './rule-hit';

/**
 * 构造一条测试用命中记录。
 * @param ruleId 业务规则 ID
 * @param action 动作类型
 * @returns 字段完整的命中记录
 */
function hit(ruleId: string, action: RuleActionType = RuleActionType.Block): RuleHit {
  return { ruleId, action, url: 'https://example.com/api', method: 'GET', at: 1 };
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

  it('按业务规则归并并投影成摘要', () => {
    const log = appendHits(createTabHitLog(), [hit('a'), hit('b'), hit('a')]);

    expect(countByRule(log.hits)).toEqual({ a: 2, b: 1 });
    expect(summarizeHits(log)).toEqual({
      total: 3,
      byRule: { a: 2, b: 1 },
      truncated: false,
    });
    expect(summarizeHits(undefined)).toEqual({ total: 0, byRule: {}, truncated: false });
  });

  it('拒绝字段非法或动作类型未知的上报', () => {
    expect(parseHits([
      { ruleId: 'a', action: RuleActionType.Delay, url: 'https://x/', method: 'POST', at: 5 },
      { ruleId: '', action: RuleActionType.Block, url: 'https://x/', method: 'GET', at: 1 },
      { ruleId: 'b', action: 'not-a-real-action', url: 'https://x/', method: 'GET', at: 1 },
      { ruleId: 'c', action: RuleActionType.Block, url: 'https://x/', method: 'GET', at: 'NaN' },
      { ruleId: 'd', action: RuleActionType.Block, url: 'x'.repeat(4096), method: 'GET', at: 1 },
      'not-an-object',
    ])).toEqual([
      { ruleId: 'a', action: RuleActionType.Delay, url: 'https://x/', method: 'POST', at: 5 },
    ]);
    expect(parseHits('not-an-array')).toEqual([]);
  });

  it('单条消息上报的命中数量受限', () => {
    /** 远超单条消息上限的上报。 */
    const flood = Array.from({ length: 500 }, () => ({
      ruleId: 'a',
      action: RuleActionType.Block,
      url: 'https://x/',
      method: 'GET',
      at: 1,
    }));

    expect(parseHits(flood)).toHaveLength(100);
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
