import { describe, expect, it } from 'vitest';
import {
  countRuleActions,
  mergeRuleMatchCounts,
  parseRuleMatchCounts,
  parseStoredRuleMatchCounts,
  subtractRuleMatchCounts,
  sumRuleMatchCounts,
} from './rule-match-counts';

describe('rule-match-counts', () => {
  it('按业务规则归并实际执行的动作', () => {
    expect(countRuleActions(['rule-a', 'rule-b', 'rule-a'])).toEqual([
      { ruleId: 'rule-a', count: 2 },
      { ruleId: 'rule-b', count: 1 },
    ]);
  });

  it('合并 DNR 与页面补丁的逐规则动作计数', () => {
    /** 两条执行通道合并后的规则动作计数。 */
    const mergedCounts = mergeRuleMatchCounts(
      [{ ruleId: 'rule-a', count: 2 }],
      [
        { ruleId: 'rule-a', count: 1 },
        { ruleId: 'rule-b', count: 3 },
      ],
    );

    expect(mergedCounts).toEqual([
      { ruleId: 'rule-a', count: 3 },
      { ruleId: 'rule-b', count: 3 },
    ]);
    expect(sumRuleMatchCounts(mergedCounts)).toBe(6);
  });

  it('拒绝非法页面消息并在合并后限制单条规则的动作增量', () => {
    expect(parseRuleMatchCounts([
      { ruleId: 'rule-a', count: 8_000 },
      { ruleId: 'rule-a', count: 8_000 },
      { ruleId: 'rule-b', count: 999 },
      { ruleId: 1, count: 1 },
      { ruleId: 'rule-c', count: 0 },
      { ruleId: '', count: 1 },
    ])).toEqual([
      { ruleId: 'rule-a', count: 10_000 },
      { ruleId: 'rule-b', count: 999 },
    ]);
  });

  it('回滚失败批次且保留 storage 中的大额累计计数', () => {
    /** 回滚一批页面补丁动作后的累计计数。 */
    const rolledBackCounts = subtractRuleMatchCounts(
      [
        { ruleId: 'rule-a', count: 12 },
        { ruleId: 'rule-b', count: 2 },
      ],
      [
        { ruleId: 'rule-a', count: 5 },
        { ruleId: 'rule-b', count: 2 },
      ],
    );

    expect(rolledBackCounts).toEqual([{ ruleId: 'rule-a', count: 7 }]);
    expect(parseStoredRuleMatchCounts([{ ruleId: 'rule-a', count: 20_000 }]))
      .toEqual([{ ruleId: 'rule-a', count: 20_000 }]);
  });

  it('汇总多个超大累计计数时保持安全整数', () => {
    expect(sumRuleMatchCounts([
      { ruleId: 'rule-a', count: Number.MAX_SAFE_INTEGER },
      { ruleId: 'rule-b', count: Number.MAX_SAFE_INTEGER },
    ])).toBe(Number.MAX_SAFE_INTEGER);
  });
});
