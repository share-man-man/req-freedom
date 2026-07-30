import type { DnrRegistrationIssues, Rule, RuleActionType } from '@req-freedom/shared';
import { DNR_RULE_ID_OFFSET } from '@req-freedom/shared';
import { toDnrRules, type CompiledDnrRule } from './dnr';

/** 由业务规则转换出的、非空的 DNR 规则。 */
export type DnrRule = CompiledDnrRule['dnrRule'];

/** updateDynamicRules / updateSessionRules 共用的更新入参。 */
export interface DnrUpdateArg {
  /** 需要移除的 DNR 规则 ID。 */
  removeRuleIds?: number[];
  /** 需要新增的 DNR 规则。 */
  addRules?: DnrRule[];
}

/** 一条业务规则与其某个动作编译出的 DNR 规则的配对，便于把注册结果归回源规则与源动作。 */
export interface DnrEntry extends CompiledDnrRule {
  /** 源业务规则。 */
  rule: Rule;
}

/**
 * 一次 DNR 提交的结果。
 *
 * 「注册成功了什么」必须与「打算注册什么」分开：浏览器会拒绝非法规则，被拒的规则不会执行，
 * 命中预测与界面提示都要以这份实际结果为准。
 */
export interface DnrCommitResult {
  /** 各业务规则实际注册成功的动作类型。 */
  registeredActionsByRuleId: Map<string, Set<RuleActionType>>;
  /** 各业务规则注册失败的动作类型与浏览器给出的原因。 */
  issues: DnrRegistrationIssues;
}

/**
 * 把业务规则列表编译成 DNR entries，为每条规则分配连续的 DNR ID。
 * @param rules 待编译的业务规则（应已按通道 / 作用域筛选）
 * @param tabIdsByRuleId 各规则作用域解析出的 tabId 列表（仅 session 规则需要）
 * @returns 「业务规则 → DNR 规则」配对列表
 */
export function compileEntries(
  rules: Rule[],
  tabIdsByRuleId?: Map<string, number[]>,
): DnrEntry[] {
  /** 待注册的配对列表。 */
  const entries: DnrEntry[] = [];
  /** 下一条 DNR 规则可使用的 ID。 */
  let nextDnrId = DNR_RULE_ID_OFFSET;
  for (const rule of rules) {
    /** 当前规则作用域解析出的目标 tabId（无作用域时为 undefined）。 */
    const tabIds = tabIdsByRuleId?.get(rule.id);
    /** 当前业务规则编译出的全部网络层动作。 */
    const compiledRules = toDnrRules(rule, nextDnrId, tabIds);
    nextDnrId += compiledRules.length;
    entries.push(...compiledRules.map((compiled) => ({ rule, ...compiled })));
  }
  return entries;
}

/**
 * 把编译结果按「全部注册成功」记入提交结果，用于整批提交成功的场景。
 * @param entries 已注册的配对列表
 * @returns 逐规则的成功动作集合
 */
export function toRegisteredActions(entries: DnrEntry[]): Map<string, Set<RuleActionType>> {
  /** 逐规则累计的成功动作。 */
  const registered = new Map<string, Set<RuleActionType>>();
  for (const entry of entries) {
    /** 该规则已累计的成功动作集合。 */
    const actions = registered.get(entry.rule.id) ?? new Set<RuleActionType>();
    actions.add(entry.actionType);
    registered.set(entry.rule.id, actions);
  }
  return registered;
}

/**
 * 累积一条规则的注册失败记录。
 *
 * 同一规则的多个动作可能因不同原因被拒；只留第一条会让界面上的报错与实际失败动作对不上，
 * 因此按去重后的顺序把原因都拼上。
 * @param issues 待累积的失败记录集合（就地修改）
 * @param ruleId 业务规则 ID
 * @param actionType 被拒绝的动作类型
 * @param message 浏览器给出的原始报错
 */
function addIssue(
  issues: DnrRegistrationIssues,
  ruleId: string,
  actionType: RuleActionType,
  message: string,
): void {
  /** 该规则已累计的失败记录。 */
  const issue = issues[ruleId];
  if (!issue) {
    issues[ruleId] = { actions: [actionType], message };
    return;
  }
  issues[ruleId] = {
    actions: [...issue.actions, actionType],
    message: issue.message.includes(message) ? issue.message : `${issue.message}; ${message}`,
  };
}

/**
 * 将编译好的 entries 全量提交到某个 DNR 存储（动态或 session）。
 *
 * updateXxxRules 是全量原子操作：只要有一条 DNR 规则非法，Chrome 会拒绝整批。优先整批提交（最高效），
 * 失败再降级为逐条注册，从而隔离非法规则、保住其余规则。
 * @param getRules 读取当前已注册规则（用于全量清除）
 * @param update 提交更新的 API（updateDynamicRules / updateSessionRules）
 * @param entries 待注册的规则配对列表
 * @param label 日志用的存储名称（「动态」/「session」）
 * @returns 本次提交实际注册成功的动作与失败记录
 */
export async function commitDnr(
  getRules: () => Promise<DnrRule[]>,
  update: (arg: DnrUpdateArg) => Promise<void>,
  entries: DnrEntry[],
  label: string,
): Promise<DnrCommitResult> {
  /** 当前已注册的规则，用于全量清除。 */
  const existing = await getRules();
  /** 需要移除的规则 ID 列表。 */
  const removeRuleIds = existing.map((rule) => rule.id);
  /** 需要新增的 DNR 规则列表。 */
  const addRules = entries.map((entry) => entry.dnrRule);
  try {
    await update({ removeRuleIds, addRules });
    return { registeredActionsByRuleId: toRegisteredActions(entries), issues: {} };
  } catch (error) {
    console.error(`[req-freedom] 整批同步 ${label} DNR 规则失败，降级为逐条注册以隔离非法规则：`, error);
    // 先整批清除旧规则（仅移除、不新增，通常不会失败）
    try {
      await update({ removeRuleIds });
    } catch (removeError) {
      console.error(`[req-freedom] 清除旧 ${label} DNR 规则失败：`, removeError);
    }
    /** 逐条注册成功的配对，用于回填快照。 */
    const succeeded: DnrEntry[] = [];
    /** 逐条注册失败的记录，用于回填快照与界面提示。 */
    const issues: DnrRegistrationIssues = {};
    // 再逐条添加，非法规则单独失败并跳过，合法规则照常生效
    for (const entry of entries) {
      try {
        await update({ addRules: [entry.dnrRule] });
        succeeded.push(entry);
      } catch (addError) {
        console.warn(`[req-freedom] 规则「${entry.rule.name}」非法，已跳过（其余规则不受影响）：`, addError);
        addIssue(issues, entry.rule.id, entry.actionType, String(addError));
      }
    }
    return { registeredActionsByRuleId: toRegisteredActions(succeeded), issues };
  }
}

/**
 * 合并多套 DNR 规则集的提交结果。
 *
 * 动态规则与 session 规则分两次提交，但命中预测与界面提示看的是合并后的全局视图。
 * @param results 各规则集的提交结果
 * @returns 合并后的成功动作与失败记录
 */
export function mergeCommitResults(results: readonly DnrCommitResult[]): DnrCommitResult {
  /** 合并后的成功动作。 */
  const registeredActionsByRuleId = new Map<string, Set<RuleActionType>>();
  /** 合并后的失败记录。 */
  const issues: DnrRegistrationIssues = {};
  for (const result of results) {
    for (const [ruleId, actions] of result.registeredActionsByRuleId) {
      /** 该规则在各规则集中累计的成功动作。 */
      const merged = registeredActionsByRuleId.get(ruleId) ?? new Set<RuleActionType>();
      for (const action of actions) {
        merged.add(action);
      }
      registeredActionsByRuleId.set(ruleId, merged);
    }
    for (const [ruleId, issue] of Object.entries(result.issues)) {
      for (const actionType of issue.actions) {
        addIssue(issues, ruleId, actionType, issue.message);
      }
    }
  }
  return { registeredActionsByRuleId, issues };
}
