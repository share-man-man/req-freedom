import { RuleActionType, RuleExecutionChannel } from '@req-freedom/shared';
import type { HttpMethod, Rule, RuleAction, RuleGroup } from '@req-freedom/shared';
import { matchUrl } from './matcher';

/**
 * 将分组扁平化为「当前生效」的规则列表
 *
 * 仅保留启用分组（group.enabled）下的启用规则（rule.enabled），并保持分组顺序与组内顺序。
 * 全局开关（是否整体停用）由调用方在此之外单独判断。
 * @param groups 全部规则分组
 * @returns 扁平化后的生效规则列表
 */
export function collectActiveRules(groups: RuleGroup[]): Rule[] {
  return groups
    .filter((group) => group.enabled)
    .flatMap((group) => group.rules.filter((rule) => rule.enabled));
}

/**
 * 找出命中给定 URL 的所有已启用规则
 * @param url 完整请求 URL
 * @param rules 全部规则
 * @returns 命中的规则列表（保持原有顺序）
 */
export function findMatchedRules(url: string, method: string, rules: Rule[]): Rule[] {
  /** 规范化后的请求方法。 */
  const normalizedMethod = method.toUpperCase() as HttpMethod;
  return rules.filter(
    (rule) =>
      rule.enabled &&
      matchUrl(url, rule.matchType, rule.pattern) &&
      (rule.methods.length === 0 || rule.methods.includes(normalizedMethod)),
  );
}

/**
 * 从规则列表中挑出第一条指定类型的规则（用于 Mock / 延迟这类“单条生效”的场景）
 * @param rules 候选规则列表（一般是 findMatchedRules 的结果）
 * @param type 目标规则类型
 * @returns 命中的规则，未命中返回 undefined
 */
export function pickActionByType<T extends RuleActionType>(
  rules: Rule[],
  type: T,
): Extract<RuleAction, { type: T }> | undefined {
  return rules.flatMap((rule) => rule.actions).find(
    (action): action is Extract<RuleAction, { type: T }> => action.type === type,
  );
}

/**
 * 从规则列表中挑出全部指定类型的规则（用于可叠加生效的场景，如脚本注入）
 * @param rules 候选规则列表（一般是 findMatchedRules 的结果）
 * @param type 目标规则类型
 * @returns 命中的同类型规则列表（保持原有顺序）
 */
export function filterActionsByType<T extends RuleActionType>(
  rules: Rule[],
  type: T,
): Extract<RuleAction, { type: T }>[] {
  return rules.flatMap((rule) => rule.actions).filter(
    (action): action is Extract<RuleAction, { type: T }> => action.type === type,
  );
}

/**
 * 按执行通道筛选规则。
 * @param rules 候选规则列表
 * @param channel 目标执行通道
 * @returns 属于该通道的规则列表
 */
export function filterRulesByChannel(rules: Rule[], channel: RuleExecutionChannel): Rule[] {
  return rules.filter((rule) => rule.channel === channel);
}
