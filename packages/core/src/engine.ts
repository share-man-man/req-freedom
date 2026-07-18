import type { Rule, RuleType } from '@req-freedom/shared';
import { matchUrl } from './matcher';

/**
 * 找出命中给定 URL 的所有已启用规则
 * @param url 完整请求 URL
 * @param rules 全部规则
 * @returns 命中的规则列表（保持原有顺序）
 */
export function findMatchedRules(url: string, rules: Rule[]): Rule[] {
  return rules.filter((rule) => rule.enabled && matchUrl(url, rule.matchType, rule.pattern));
}

/**
 * 从规则列表中挑出第一条指定类型的规则（用于 Mock / 延迟这类“单条生效”的场景）
 * @param rules 候选规则列表（一般是 findMatchedRules 的结果）
 * @param type 目标规则类型
 * @returns 命中的规则，未命中返回 undefined
 */
export function pickRuleByType<T extends RuleType>(
  rules: Rule[],
  type: T,
): Extract<Rule, { type: T }> | undefined {
  return rules.find((rule): rule is Extract<Rule, { type: T }> => rule.type === type);
}

/**
 * 从规则列表中挑出全部指定类型的规则（用于可叠加生效的场景，如脚本注入）
 * @param rules 候选规则列表（一般是 findMatchedRules 的结果）
 * @param type 目标规则类型
 * @returns 命中的同类型规则列表（保持原有顺序）
 */
export function filterRulesByType<T extends RuleType>(
  rules: Rule[],
  type: T,
): Extract<Rule, { type: T }>[] {
  return rules.filter((rule): rule is Extract<Rule, { type: T }> => rule.type === type);
}
