import type { Rule, RuleActionType } from '@req-freedom/shared';

/**
 * Service Worker 内缓存的 DNR 通道生效规则快照。
 *
 * 存在的唯一理由是让逐请求匹配保持同步：webRequest 观测每个请求，若每次都
 * `await getGroups()`，会把 await 引回记录路径，从而重新需要串行写队列。
 */
export interface ActiveDnrRuleSnapshot {
  /** 当前生效且走 DNR 通道的规则。 */
  rules: Rule[];
  /** 限定作用域的规则解析出的目标 tabId；不限定作用域的规则无条目。 */
  tabIdsByRuleId: Map<string, number[]>;
  /**
   * 各规则**实际注册到 DNR 的**动作类型。
   *
   * 命中预测必须以它为准，而不是规则里声明了哪些动作：非法规则会被浏览器拒绝且不会生效，
   * 若照常预测命中，界面就会宣称一条根本没注册上的规则生效了。它同时也编码了「哪些动作
   * 类型由 DNR 执行」——能出现在这里的动作，都是 toDnrRules 编译得出来的动作。
   */
  registeredActionsByRuleId: Map<string, Set<RuleActionType>>;
}

/** 当前快照；DNR 规则每次同步后由 background 覆盖。 */
let snapshot: ActiveDnrRuleSnapshot = {
  rules: [],
  tabIdsByRuleId: new Map(),
  registeredActionsByRuleId: new Map(),
};

/**
 * 覆盖 DNR 通道生效规则快照。
 * @param next 最新快照
 */
export function setActiveDnrRules(next: ActiveDnrRuleSnapshot): void {
  snapshot = next;
}

/**
 * 同步读取 DNR 通道生效规则快照。
 * @returns 当前快照
 */
export function getActiveDnrRules(): ActiveDnrRuleSnapshot {
  return snapshot;
}
