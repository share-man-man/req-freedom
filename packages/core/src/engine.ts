import { RuleActionType, RuleExecutionChannel, RuleScopeType } from '@req-freedom/shared';
import type { HttpMethod, Rule, RuleAction, RuleGroup, ScopeContext } from '@req-freedom/shared';
import { matchRequestBody, matchScope, matchUrl } from './matcher';

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
 * 判断规则列表中是否存在带请求体匹配条件的规则
 *
 * 读取请求体（clone / 解码）有成本，调用方据此决定是否需要为二次过滤读取请求体。
 * @param rules 候选规则列表（一般是 findMatchedRules 的结果）
 * @returns 有任意规则配置了请求体匹配条件时返回 true
 */
export function rulesNeedBody(rules: Rule[]): boolean {
  return rules.some((rule) => rule.bodyMatch !== undefined);
}

/**
 * 按请求体匹配条件对规则做二次过滤
 *
 * 未配置请求体条件的规则一律保留；配置了条件的规则需请求体命中才保留。
 * @param rules URL + 方法已命中的候选规则列表
 * @param body 请求体文本（无法读取时传空串）
 * @returns 请求体条件也命中的规则列表（保持原有顺序）
 */
export function filterRulesByBody(rules: Rule[], body: string): Rule[] {
  return rules.filter((rule) => rule.bodyMatch === undefined || matchRequestBody(rule.bodyMatch, body));
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

/**
 * 判断规则是否配置了有效的作用域限制（即非 AllTabs）
 *
 * DNR 通道据此把「限定作用域」的规则分流到 session 规则（可携带 tabIds 条件），
 * 「全部标签页」的规则仍走可跨重启保留的 dynamic 规则。
 * @param rule 业务规则
 * @returns 规则限定了作用范围时返回 true
 */
export function isRuleScoped(rule: Rule): boolean {
  return rule.scope !== undefined && rule.scope.type !== RuleScopeType.AllTabs;
}

/**
 * 按作用域对规则做过滤（供页面补丁通道按自身标签上下文收敛规则）
 * @param rules 候选规则列表
 * @param context 当前标签的运行时上下文
 * @returns 作用域命中当前上下文的规则列表（保持原有顺序）
 */
export function filterRulesByScope(rules: Rule[], context: ScopeContext): Rule[] {
  return rules.filter((rule) => matchScope(rule.scope, context));
}
