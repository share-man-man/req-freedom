import type { RuleMatchCount } from '@req-freedom/shared';

/** 单次跨上下文批次最多接受的规则计数项数。 */
const MAX_RULE_COUNT_ITEMS = 100;

/** 单个规则在一次跨上下文批次中最多增加的动作数。 */
const MAX_ACTION_COUNT_PER_RULE = 10_000;

/** 跨上下文协议允许的业务规则 ID 最大长度。 */
const MAX_RULE_ID_LENGTH = 256;

/**
 * 把规则 ID 序列归并成逐规则动作计数。
 * @param ruleIds 每个实际执行动作所属的业务规则 ID
 * @returns 按首次出现顺序归并后的规则动作计数
 */
export function countRuleActions(ruleIds: readonly string[]): RuleMatchCount[] {
  /** 按首次出现顺序累计的规则动作计数。 */
  const countsByRuleId = new Map<string, number>();
  for (const ruleId of ruleIds) {
    countsByRuleId.set(ruleId, (countsByRuleId.get(ruleId) ?? 0) + 1);
  }
  return [...countsByRuleId].map(([ruleId, count]) => ({ ruleId, count }));
}

/**
 * 合并多组逐规则动作计数。
 * @param groups 待合并的规则动作计数组
 * @returns 按首次出现顺序累加后的规则动作计数
 */
export function mergeRuleMatchCounts(
  ...groups: readonly (readonly RuleMatchCount[])[]
): RuleMatchCount[] {
  /** 按首次出现顺序累计的规则动作计数。 */
  const countsByRuleId = new Map<string, number>();
  for (const group of groups) {
    for (const item of group) {
      countsByRuleId.set(
        item.ruleId,
        Math.min(
          Number.MAX_SAFE_INTEGER,
          (countsByRuleId.get(item.ruleId) ?? 0) + item.count,
        ),
      );
    }
  }
  return [...countsByRuleId].map(([ruleId, count]) => ({ ruleId, count }));
}

/**
 * 从累计计数中扣除一批动作，用于原生计数写入失败时补偿回滚。
 * @param current 当前累计计数
 * @param decrement 待扣除的动作计数
 * @returns 扣除后仍大于零的逐规则动作计数
 */
export function subtractRuleMatchCounts(
  current: readonly RuleMatchCount[],
  decrement: readonly RuleMatchCount[],
): RuleMatchCount[] {
  /** 待扣除的逐规则动作计数。 */
  const decrementByRuleId = new Map(
    mergeRuleMatchCounts(decrement).map((item) => [item.ruleId, item.count]),
  );
  return current.flatMap((item) => {
    /** 当前规则完成扣除后的剩余动作数。 */
    const count = Math.max(0, item.count - (decrementByRuleId.get(item.ruleId) ?? 0));
    return count > 0 ? [{ ruleId: item.ruleId, count }] : [];
  });
}

/**
 * 汇总逐规则动作计数的总动作数。
 * @param ruleCounts 逐规则动作计数
 * @returns 所有规则动作数之和
 */
export function sumRuleMatchCounts(ruleCounts: readonly RuleMatchCount[]): number {
  return ruleCounts.reduce(
    (total, item) => Math.min(Number.MAX_SAFE_INTEGER, total + item.count),
    0,
  );
}

/**
 * 校验并归并来自页面消息的逐规则动作计数。
 * @param value 未受信任的页面消息字段
 * @returns 数量受限、字段合法且按规则归并的动作计数
 */
export function parseRuleMatchCounts(value: unknown): RuleMatchCount[] {
  if (!Array.isArray(value)) {
    return [];
  }
  /** 通过字段与数量校验的规则动作计数。 */
  const validCounts = value
    .slice(0, MAX_RULE_COUNT_ITEMS)
    .filter(
      (item): item is RuleMatchCount =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { ruleId?: unknown }).ruleId === 'string' &&
        (item as { ruleId: string }).ruleId.length > 0 &&
        (item as { ruleId: string }).ruleId.length <= MAX_RULE_ID_LENGTH &&
        Number.isInteger((item as { count?: unknown }).count) &&
        Number((item as { count?: unknown }).count) > 0,
    )
    .map((item) => ({
      ruleId: item.ruleId,
      count: Math.min(item.count, Number.MAX_SAFE_INTEGER),
    }));
  return mergeRuleMatchCounts(validCounts).map((item) => ({
    ...item,
    // 合并后再限幅，避免通过重复 ruleId 绕过单规则批次上限。
    count: Math.min(item.count, MAX_ACTION_COUNT_PER_RULE),
  }));
}

/**
 * 校验 storage.session 中的累计逐规则计数，不应用跨上下文单批次限额。
 * @param value 未知的持久化字段
 * @returns 字段合法且按规则归并的累计动作计数
 */
export function parseStoredRuleMatchCounts(value: unknown): RuleMatchCount[] {
  if (!Array.isArray(value)) {
    return [];
  }
  /** 合法的持久化累计计数。 */
  const validCounts = value.filter(
    (item): item is RuleMatchCount =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { ruleId?: unknown }).ruleId === 'string' &&
      (item as { ruleId: string }).ruleId.length > 0 &&
      (item as { ruleId: string }).ruleId.length <= MAX_RULE_ID_LENGTH &&
      Number.isSafeInteger((item as { count?: unknown }).count) &&
      Number((item as { count?: unknown }).count) > 0,
  );
  return mergeRuleMatchCounts(validCounts);
}
