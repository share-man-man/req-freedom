import { describe, expect, it } from 'vitest';
import { allocateStableDnrRuleId } from './dnr-rule-id';

describe('allocateStableDnrRuleId', () => {
  it('为相同业务规则动作生成稳定 ID', () => {
    /** 第一次编译得到的 DNR ID。 */
    const firstId = allocateStableDnrRuleId('rule-a:0', new Set());
    /** 重新同步后由相同输入得到的 DNR ID。 */
    const secondId = allocateStableDnrRuleId('rule-a:0', new Set());

    expect(secondId).toBe(firstId);
  });

  it('在当前规则集发生哈希冲突时顺延到空闲 ID', () => {
    /** 初次分配得到的稳定 DNR ID。 */
    const occupiedId = allocateStableDnrRuleId('rule-a:0', new Set());
    /** 模拟当前规则集已占用初始候选。 */
    const usedIds = new Set([occupiedId]);
    /** 冲突后分配到的下一个空闲 DNR ID。 */
    const resolvedId = allocateStableDnrRuleId('rule-a:0', usedIds);

    expect(resolvedId).not.toBe(occupiedId);
    expect(usedIds.has(resolvedId)).toBe(true);
  });
});
