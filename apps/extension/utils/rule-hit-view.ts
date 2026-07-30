import type { RuleHit } from '@req-freedom/shared';
import { RuleActionType, RuleHitOutcome } from '@req-freedom/shared';

/**
 * 请求日志视图的筛选条件。
 *
 * 各字段为 null 表示该维度不过滤；空关键词同样视为不过滤。
 */
export interface HitLogFilter {
  /** 关键词，匹配请求 URL、请求方法与规则名称，大小写不敏感。 */
  keyword: string;
  /** 只看某条规则的命中。 */
  ruleId: string | null;
  /** 只看某类动作的命中。 */
  action: RuleActionType | null;
  /** 只看某种执行结果（已生效 / 未应用）的命中。 */
  outcome: RuleHitOutcome | null;
}

/** 不做任何过滤的筛选条件，供视图初始化与「重置」使用。 */
export const EMPTY_HIT_LOG_FILTER: HitLogFilter = {
  keyword: '',
  ruleId: null,
  action: null,
  outcome: null,
};

/** 单条规则在当前日志中的命中统计。 */
export interface RuleHitCount {
  /** 业务规则 ID。 */
  ruleId: string;
  /** 该规则的命中记录总数。 */
  total: number;
  /** 其中实际执行成功的条数。 */
  applied: number;
}

/**
 * 按筛选条件过滤命中记录。
 *
 * 规则名称不在命中记录里（日志只存规则 ID），由调用方把当前规则表投影成 ID → 名称传入，
 * 使关键词也能按规则名搜索；查不到名称的记录（规则已被删除）只按 URL 与方法匹配。
 * @param hits 原始命中记录
 * @param filter 筛选条件
 * @param ruleNameById 规则 ID 到名称的映射
 * @returns 保持原始顺序的命中记录
 */
export function filterHits(
  hits: readonly RuleHit[],
  filter: HitLogFilter,
  ruleNameById: Readonly<Record<string, string>> = {},
): RuleHit[] {
  /** 归一化后的关键词。 */
  const keyword = filter.keyword.trim().toLocaleLowerCase();
  return hits.filter((hit) => {
    if (filter.ruleId !== null && hit.ruleId !== filter.ruleId) {
      return false;
    }
    if (filter.action !== null && hit.action !== filter.action) {
      return false;
    }
    if (filter.outcome !== null && hit.outcome !== filter.outcome) {
      return false;
    }
    if (keyword === '') {
      return true;
    }
    /** 参与关键词匹配的文本。 */
    const haystack = [hit.url, hit.method, ruleNameById[hit.ruleId] ?? ''];
    return haystack.some((text) => text.toLocaleLowerCase().includes(keyword));
  });
}

/**
 * 按规则归并命中次数。
 *
 * 请求日志里同一条规则会出现很多次，先给出「哪条规则命中得最多」再让用户下钻，
 * 比直接扫一千行更快定位问题。
 * @param hits 原始命中记录
 * @returns 按命中总数倒序排列的逐规则统计；总数相同时保持首次出现顺序
 */
export function countHitsByRule(hits: readonly RuleHit[]): RuleHitCount[] {
  /** 按首次出现顺序累计的逐规则统计。 */
  const countsByRuleId = new Map<string, RuleHitCount>();
  for (const hit of hits) {
    /** 当前规则已累计的统计，首次出现时初始化。 */
    const count = countsByRuleId.get(hit.ruleId) ?? { ruleId: hit.ruleId, total: 0, applied: 0 };
    count.total += 1;
    if (hit.outcome === RuleHitOutcome.Applied) {
      count.applied += 1;
    }
    countsByRuleId.set(hit.ruleId, count);
  }
  // Array.prototype.sort 稳定，总数相同的规则因此保持首次命中顺序
  return [...countsByRuleId.values()].sort((left, right) => right.total - left.total);
}
