import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Rule } from '@req-freedom/shared';
import { DNR_RULE_ID_OFFSET, STORAGE_KEY_ENABLED, STORAGE_KEY_GROUPS } from '@req-freedom/shared';
import { collectActiveRules } from '@req-freedom/core';
import { toDnrRules } from '@/utils/dnr';
import { getEnabled, getGroups } from '@/utils/storage';

/** 由业务规则转换出的、非空的 DNR 动态规则 */
type DnrRule = ReturnType<typeof toDnrRules>[number];

/** 一条业务规则与其对应的 DNR 规则的配对，便于失败时定位到源规则 */
interface DnrEntry {
  /** 源业务规则，仅用于日志定位 */
  rule: Rule;
  /** 转换后的 DNR 动态规则 */
  dnrRule: DnrRule;
}

/**
 * 逐条注册 DNR 规则，跳过非法的那几条，避免一条坏规则拖垮全部
 *
 * 仅在整批提交失败后作为降级路径调用；正常情况下不会走到这里。
 * @param removeRuleIds 需要先移除的旧规则 ID 列表
 * @param entries 待注册的规则配对列表
 */
async function syncDnrRulesIndividually(
  removeRuleIds: number[],
  entries: DnrEntry[],
): Promise<void> {
  // 先整批清除旧规则（仅移除、不新增，通常不会失败）
  try {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  } catch (error) {
    console.error('[req-freedom] 清除旧 DNR 规则失败：', error);
  }
  // 再逐条添加，非法规则单独失败并跳过，合法规则照常生效
  for (const { rule, dnrRule } of entries) {
    try {
      await browser.declarativeNetRequest.updateDynamicRules({ addRules: [dnrRule] });
    } catch (error) {
      console.warn(`[req-freedom] 规则「${rule.name}」非法，已跳过（其余规则不受影响）：`, error);
    }
  }
}

/**
 * 将 storage 中的规则同步为 declarativeNetRequest 动态规则
 *
 * 关键步骤：
 * 1. 读取全局开关与规则分组
 * 2. 清空本插件之前注册的全部动态规则
 * 3. 全局开启时，把生效规则中可由 DNR 承载的部分（拦截/重定向/参数注入/Header 改写）重新注册
 * 4. 整批提交失败时降级为逐条注册，隔离非法规则
 */
async function syncDnrRules(): Promise<void> {
  /** 全局开关状态 */
  const enabled = await getEnabled();
  /** 全部规则分组 */
  const groups = await getGroups();
  /** 当前生效规则（启用分组下的启用规则）；全局停用时视为空 */
  const activeRules = enabled ? collectActiveRules(groups) : [];

  /** 当前已注册的动态规则，用于全量清除 */
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  /** 需要移除的规则 ID 列表 */
  const removeRuleIds = existing.map((rule) => rule.id);

  /** 待注册的「业务规则 → DNR 规则」配对列表 */
  const entries: DnrEntry[] = [];
  /** 下一条 DNR 规则可使用的 ID。 */
  let nextDnrId = DNR_RULE_ID_OFFSET;
  for (const rule of activeRules) {
    /** 当前业务规则编译出的全部网络层动作。 */
    const compiledRules = toDnrRules(rule, nextDnrId);
    nextDnrId += compiledRules.length;
    entries.push(...compiledRules.map((dnrRule) => ({ rule, dnrRule })));
  }
  /** 需要新增的 DNR 规则列表 */
  const addRules = entries.map((entry) => entry.dnrRule);

  // updateDynamicRules 是全量原子操作：只要有一条 DNR 规则非法（如重定向目标不是绝对
  // URL），Chrome 会拒绝整批、所有规则都不生效。优先整批提交（最高效），失败再降级为逐条
  // 注册，从而隔离非法规则、保住其余规则。
  try {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (error) {
    console.error('[req-freedom] 整批同步 DNR 规则失败，降级为逐条注册以隔离非法规则：', error);
    await syncDnrRulesIndividually(removeRuleIds, entries);
  }
}

export default defineBackground(() => {
  // 启动时同步一次，保证 DNR 规则与 storage 一致
  void syncDnrRules();

  // 规则或全局开关变化时重新同步
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes) {
      void syncDnrRules();
    }
  });
});
