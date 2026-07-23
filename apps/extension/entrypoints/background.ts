import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Rule, ScopeContext } from '@req-freedom/shared';
import {
  DNR_RULE_ID_OFFSET,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, isRuleScoped } from '@req-freedom/core';
import { toDnrRules } from '@/utils/dnr';
import { queryAllTabs, resolveScopeTabIds } from '@/utils/scope';
import { getEnabled, getGroups } from '@/utils/storage';

/** 由业务规则转换出的、非空的 DNR 规则 */
type DnrRule = ReturnType<typeof toDnrRules>[number];

/** updateDynamicRules / updateSessionRules 共用的更新入参。 */
type DnrUpdateArg = { removeRuleIds?: number[]; addRules?: DnrRule[] };

/** 一条业务规则与其对应的 DNR 规则的配对，便于失败时定位到源规则 */
interface DnrEntry {
  /** 源业务规则，仅用于日志定位 */
  rule: Rule;
  /** 转换后的 DNR 规则 */
  dnrRule: DnrRule;
}

/**
 * 把业务规则列表编译成 DNR entries，为每条规则分配连续的 DNR ID
 * @param rules 待编译的业务规则（应已按通道 / 作用域筛选）
 * @param tabIdsByRuleId 各规则作用域解析出的 tabId 列表（仅 session 规则需要）
 * @returns 「业务规则 → DNR 规则」配对列表
 */
function compileEntries(rules: Rule[], tabIdsByRuleId?: Map<string, number[]>): DnrEntry[] {
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
    entries.push(...compiledRules.map((dnrRule) => ({ rule, dnrRule })));
  }
  return entries;
}

/**
 * 将编译好的 entries 全量提交到某个 DNR 存储（动态或 session）
 *
 * updateXxxRules 是全量原子操作：只要有一条 DNR 规则非法，Chrome 会拒绝整批。优先整批提交（最高效），
 * 失败再降级为逐条注册，从而隔离非法规则、保住其余规则。
 * @param getRules 读取当前已注册规则（用于全量清除）
 * @param update 提交更新的 API（updateDynamicRules / updateSessionRules）
 * @param entries 待注册的规则配对列表
 * @param label 日志用的存储名称（「动态」/「session」）
 */
async function commitDnr(
  getRules: () => Promise<DnrRule[]>,
  update: (arg: DnrUpdateArg) => Promise<void>,
  entries: DnrEntry[],
  label: string,
): Promise<void> {
  /** 当前已注册的规则，用于全量清除。 */
  const existing = await getRules();
  /** 需要移除的规则 ID 列表。 */
  const removeRuleIds = existing.map((rule) => rule.id);
  /** 需要新增的 DNR 规则列表。 */
  const addRules = entries.map((entry) => entry.dnrRule);
  try {
    await update({ removeRuleIds, addRules });
  } catch (error) {
    console.error(`[req-freedom] 整批同步 ${label} DNR 规则失败，降级为逐条注册以隔离非法规则：`, error);
    // 先整批清除旧规则（仅移除、不新增，通常不会失败）
    try {
      await update({ removeRuleIds });
    } catch (removeError) {
      console.error(`[req-freedom] 清除旧 ${label} DNR 规则失败：`, removeError);
    }
    // 再逐条添加，非法规则单独失败并跳过，合法规则照常生效
    for (const { rule, dnrRule } of entries) {
      try {
        await update({ addRules: [dnrRule] });
      } catch (addError) {
        console.warn(`[req-freedom] 规则「${rule.name}」非法，已跳过（其余规则不受影响）：`, addError);
      }
    }
  }
}

/**
 * 读取当前生效规则（全局停用时视为空）
 * @returns 当前生效的业务规则列表
 */
async function getActiveRules(): Promise<Rule[]> {
  /** 全局开关状态。 */
  const enabled = await getEnabled();
  /** 全部规则分组。 */
  const groups = await getGroups();
  return enabled ? collectActiveRules(groups) : [];
}

/**
 * 同步「全部标签页」作用域的 DNR 动态规则
 *
 * 动态规则可跨浏览器重启保留，承载不限定作用范围的规则；限定作用域的规则改走 session 规则。
 */
async function syncDynamicRules(): Promise<void> {
  /** 当前生效且不限定作用域的规则。 */
  const unscopedRules = (await getActiveRules()).filter((rule) => !isRuleScoped(rule));
  await commitDnr(
    () => browser.declarativeNetRequest.getDynamicRules(),
    (arg) => browser.declarativeNetRequest.updateDynamicRules(arg),
    compileEntries(unscopedRules),
    '动态',
  );
}

/**
 * 同步「限定作用域」的 DNR session 规则
 *
 * declarativeNetRequest 只有 session 规则支持 tabIds 条件，且没有 window / group 条件，
 * 因此窗口 / 标签组作用域都要先解析成当前包含的 tabId 集合。作用域当前无匹配标签的规则不注册（fail closed）。
 * session 规则随浏览器重启清空，与「tab/窗口/分组 ID 皆为会话级」的语义天然一致。
 */
async function syncSessionRules(): Promise<void> {
  /** 当前生效且限定了作用域的规则。 */
  const scopedRules = (await getActiveRules()).filter(isRuleScoped);
  /** 当前全部标签页快照，用于把作用域解析成 tabId。 */
  const tabs = await queryAllTabs();
  /** 各规则解析出的目标 tabId 列表。 */
  const tabIdsByRuleId = new Map<string, number[]>();
  /** 作用域当前有匹配标签、可注册的规则。 */
  const registrableRules = scopedRules.filter((rule) => {
    /** 规则作用域当前解析出的 tabId 列表。 */
    const tabIds = resolveScopeTabIds(rule.scope, tabs);
    if (tabIds.length === 0) {
      return false;
    }
    tabIdsByRuleId.set(rule.id, tabIds);
    return true;
  });
  await commitDnr(
    () => browser.declarativeNetRequest.getSessionRules(),
    (arg) => browser.declarativeNetRequest.updateSessionRules(arg),
    compileEntries(registrableRules, tabIdsByRuleId),
    'session',
  );
}

/** session 规则重算的去抖定时器，合并标签事件风暴。 */
let sessionResyncTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 去抖地重算 session 规则
 *
 * 标签的创建 / 关闭 / 移动 / 归组都会改变作用域对应的 tabId 集合，短时间内可能连续触发，
 * 合并成一次重算即可。
 */
function scheduleSessionResync(): void {
  if (sessionResyncTimer !== undefined) {
    clearTimeout(sessionResyncTimer);
  }
  sessionResyncTimer = setTimeout(() => {
    sessionResyncTimer = undefined;
    void syncSessionRules();
  }, 100);
}

/**
 * 把某个标签最新的作用域上下文推送给它的桥接脚本
 *
 * 标签被移入 / 移出分组或在窗口间移动后，页面补丁通道需要据此重新过滤规则；
 * background 拿到变化事件后主动下发新上下文，避免页面侧规则过滤过期。
 * @param tabId 目标标签 ID
 */
async function pushScopeContext(tabId: number): Promise<void> {
  try {
    /** 目标标签的最新信息。 */
    const tab = await browser.tabs.get(tabId);
    /** 推送给桥接脚本的最新作用域上下文。 */
    const context: ScopeContext = { tabId: tab.id, windowId: tab.windowId, groupId: tab.groupId };
    await browser.tabs.sendMessage(tabId, { type: RUNTIME_MSG_SCOPE_CONTEXT_CHANGED, context });
  } catch {
    // 标签可能已关闭，或页面没有内容脚本（如 chrome:// 页面），忽略即可
  }
}

export default defineBackground(() => {
  // 启动时各同步一次，保证 DNR 规则与 storage 一致
  void syncDynamicRules();
  void syncSessionRules();

  // 规则或全局开关变化时，动态与 session 规则都要重新同步
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes) {
      void syncDynamicRules();
      void syncSessionRules();
    }
  });

  // 桥接脚本请求自身标签上下文：从 sender.tab 读取后回传（内容脚本拿不到自己的 tabId）
  browser.runtime.onMessage.addListener((message, sender) => {
    if ((message as { type?: string } | undefined)?.type === RUNTIME_MSG_GET_SCOPE_CONTEXT) {
      /** 从消息发送方标签解析出的作用域上下文。 */
      const context: ScopeContext = {
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId,
        groupId: sender.tab?.groupId,
      };
      return Promise.resolve(context);
    }
    return undefined;
  });

  // 标签生命周期与位置变化都会改变作用域对应的 tabId 集合，去抖重算 session 规则
  browser.tabs.onCreated.addListener(() => scheduleSessionResync());
  browser.tabs.onRemoved.addListener(() => scheduleSessionResync());
  browser.tabs.onMoved.addListener(() => scheduleSessionResync());
  browser.tabs.onReplaced.addListener(() => scheduleSessionResync());
  browser.tabs.onAttached.addListener((tabId) => {
    scheduleSessionResync();
    // 跨窗口移动后，窗口作用域需要用新 windowId 重新过滤页面侧规则
    void pushScopeContext(tabId);
  });
  browser.tabs.onDetached.addListener(() => scheduleSessionResync());
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // groupId 变化（移入 / 移出分组）既影响 session 规则，也需要下发给页面侧刷新分组作用域过滤。
    // groupId 不在 onUpdated changeInfo 的类型声明里但运行时可能出现，故经 unknown 取值。
    if ((changeInfo as unknown as { groupId?: number }).groupId !== undefined) {
      scheduleSessionResync();
      void pushScopeContext(tabId);
    }
  });

  // 标签组自身的增删改（如整组移动）也可能改变分组内标签集合，需重算 session 规则
  if (browser.tabGroups) {
    browser.tabGroups.onCreated.addListener(() => scheduleSessionResync());
    browser.tabGroups.onRemoved.addListener(() => scheduleSessionResync());
    browser.tabGroups.onUpdated.addListener(() => scheduleSessionResync());
    browser.tabGroups.onMoved.addListener(() => scheduleSessionResync());
  }
});
