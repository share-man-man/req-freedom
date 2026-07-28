import { DNR_RULE_ID_OFFSET } from '@req-freedom/shared';

/** Chrome DNR 数字规则 ID 使用的有符号 32 位整数上限。 */
const DNR_RULE_ID_MAX = 2_147_483_647;

/** 可用于稳定分配的 DNR 数字规则 ID 数量。 */
const DNR_RULE_ID_RANGE = DNR_RULE_ID_MAX - DNR_RULE_ID_OFFSET + 1;

/** FNV-1a 32 位哈希的偏移基数。 */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 32 位哈希的质数乘数。 */
const FNV_PRIME = 0x01000193;

/**
 * 为业务规则动作计算稳定的 32 位无符号哈希。
 * @param value 业务规则 ID 与动作序号组成的稳定键
 * @returns FNV-1a 32 位无符号哈希
 */
function hashDnrRuleKey(value: string): number {
  /** FNV-1a 的 32 位偏移基数。 */
  let hash = FNV_OFFSET_BASIS;
  /** 当前参与哈希的字符下标。 */
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * 为一条业务规则中的单个 DNR 动作分配稳定且不冲突的数字 ID。
 *
 * 规则同步、排序或作用域变化后，同一业务规则动作仍会优先取得相同 ID，避免
 * getMatchedRules 的历史记录被重新映射到另一条业务规则。
 * @param stableKey 业务动作稳定键或兼容旧版本的哈希键
 * @param usedIds 当前规则集中已占用的 DNR 数字 ID
 * @returns 当前规则集内唯一的稳定 DNR 数字 ID
 */
export function allocateStableDnrRuleId(
  stableKey: string,
  usedIds: Set<number>,
): number {
  if (usedIds.size >= DNR_RULE_ID_RANGE) {
    throw new Error('DNR 规则 ID 空间已耗尽');
  }
  /** 业务规则动作对应的稳定哈希键。 */
  /** 由稳定哈希映射到合法 DNR ID 区间的初始候选。 */
  let candidate = DNR_RULE_ID_OFFSET + (hashDnrRuleKey(stableKey) % DNR_RULE_ID_RANGE);
  while (usedIds.has(candidate)) {
    candidate = candidate === DNR_RULE_ID_MAX ? DNR_RULE_ID_OFFSET : candidate + 1;
  }
  usedIds.add(candidate);
  return candidate;
}
