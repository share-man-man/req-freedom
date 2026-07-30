import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Rule, RuleHit, ScopeContext } from '@req-freedom/shared';
import {
  DNR_RULE_ID_OFFSET,
  RUNTIME_MSG_CLEAR_RULE_HITS,
  RUNTIME_MSG_GET_RULE_HIT_SUMMARY,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_RULE_HIT,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  RuleExecutionChannel,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, filterRulesByChannel, isRuleScoped } from '@req-freedom/core';
import { initActionIcon, setActionIconState } from '@/utils/action-icon';
import { setActiveDnrRules } from '@/utils/active-rules-cache';
import { toDnrRules } from '@/utils/dnr';
import {
  forgetTab,
  initRuleHitObserver,
  syncSubResourceListener,
} from '@/utils/dnr-observer';
import { parseHits } from '@/utils/rule-hit';
import {
  clearHits,
  dropTab,
  getHitSummary,
  listTabsWithHits,
  recordHits,
  restoreHits,
} from '@/utils/rule-hit-store';
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

/** 串行化 DNR 同步，避免并发的规则集提交互相覆盖。 */
let dnrSyncChain: Promise<unknown> = Promise.resolve();

/**
 * 记录一批命中并同步刷新徽标状态。
 * @param tabId 命中发生的标签页
 * @param hits 本次产生的命中
 */
function applyRuleHits(tabId: number, hits: RuleHit[]): void {
  if (recordHits(tabId, hits)) {
    setActionIconState(tabId, true);
  }
}

/**
 * 把业务规则列表编译成 DNR entries，为每条规则分配连续的 DNR ID。
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
    return;
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
 * 读取当前生效的 DNR 通道规则（全局停用时视为空）
 * @returns 当前生效且走 DNR 通道的业务规则
 */
async function loadActiveDnrRules(): Promise<Rule[]> {
  /** 全局开关状态。 */
  const enabled = await getEnabled();
  if (!enabled) {
    return [];
  }
  return filterRulesByChannel(collectActiveRules(await getGroups()), RuleExecutionChannel.Dnr);
}

/**
 * 同步两套 DNR 规则集，并刷新逐请求匹配所用的规则快照。
 *
 * declarativeNetRequest 只有 session 规则支持 tabIds 条件，因此窗口 / 标签组作用域都要先解析成
 * 当前包含的 tabId 集合；作用域当前无匹配标签的规则不注册（fail closed）。
 * @returns 本轮同步完成后的 Promise
 */
function syncDnrRuleSets(): Promise<void> {
  /** 排在上一轮同步之后执行的本轮任务。 */
  const synchronization = dnrSyncChain.then(async () => {
    /** 当前生效且走 DNR 通道的规则。 */
    const activeRules = await loadActiveDnrRules();
    /** 当前全部标签页快照，用于把作用域解析成 tabId。 */
    const tabs = await queryAllTabs();
    /** 各作用域规则解析出的目标 tabId 列表。 */
    const tabIdsByRuleId = new Map<string, number[]>();
    for (const rule of activeRules) {
      if (!isRuleScoped(rule)) {
        continue;
      }
      /** 规则作用域当前解析出的 tabId 列表。 */
      const tabIds = resolveScopeTabIds(rule.scope, tabs);
      if (tabIds.length > 0) {
        tabIdsByRuleId.set(rule.id, tabIds);
      }
    }

    // 关键步骤：先更新观测快照，逐请求匹配才能与刚提交的规则集保持一致。
    setActiveDnrRules({ rules: activeRules, tabIdsByRuleId });
    syncSubResourceListener(activeRules.length > 0);

    /** 不限定作用域、由动态规则承载的规则。 */
    const unscopedRules = activeRules.filter((rule) => !isRuleScoped(rule));
    /** 限定作用域且当前有匹配标签、由 session 规则承载的规则。 */
    const scopedRules = activeRules.filter(
      (rule) => isRuleScoped(rule) && tabIdsByRuleId.has(rule.id),
    );

    /** 两套 DNR 规则集各自的同步结果。 */
    const results = await Promise.allSettled([
      commitDnr(
        () => browser.declarativeNetRequest.getDynamicRules(),
        (arg) => browser.declarativeNetRequest.updateDynamicRules(arg),
        compileEntries(unscopedRules),
        '动态',
      ),
      commitDnr(
        () => browser.declarativeNetRequest.getSessionRules(),
        (arg) => browser.declarativeNetRequest.updateSessionRules(arg),
        compileEntries(scopedRules, tabIdsByRuleId),
        'session',
      ),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[req-freedom] 同步 DNR 规则集失败：', result.reason);
      }
    }
  });
  dnrSyncChain = synchronization.catch(() => undefined);
  return synchronization;
}

/** session 规则重算的去抖定时器，合并标签事件风暴。 */
let sessionResyncTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 去抖地重算规则集
 *
 * 标签的创建 / 关闭 / 移动 / 归组都会改变作用域对应的 tabId 集合，短时间内可能连续触发，
 * 合并成一次重算即可。
 */
function scheduleResync(): void {
  if (sessionResyncTimer !== undefined) {
    clearTimeout(sessionResyncTimer);
  }
  sessionResyncTimer = setTimeout(() => {
    sessionResyncTimer = undefined;
    void syncDnrRuleSets().catch((error) => {
      console.error('[req-freedom] 重算 DNR 规则集失败：', error);
    });
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
  initActionIcon();

  // 冷启动：先从镜像恢复命中日志，再按恢复结果补回徽标状态。
  void restoreHits().then(() => {
    for (const tabId of listTabsWithHits()) {
      setActionIconState(tabId, true);
    }
  });

  // 观测式 webRequest 是本扩展唯一可用的 DNR 命中推送信号：onRuleMatchedDebug 仅未打包可用，
  // getMatchedRules 只有 pull 且受 20 次 / 10 分钟配额与 5 分钟保留窗口限制。
  initRuleHitObserver({
    onNavigationReset: (tabId) => {
      clearHits(tabId);
      setActionIconState(tabId, false);
    },
    onRuleHits: applyRuleHits,
  });

  void syncDnrRuleSets().catch((error) => {
    console.error('[req-freedom] 初始化 DNR 规则集失败：', error);
  });

  // 规则或全局开关变化时重新同步，并连带刷新观测快照与监听注册状态
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes) {
      void syncDnrRuleSets().catch((error) => {
        console.error('[req-freedom] 配置变化后同步 DNR 规则集失败：', error);
      });
    }
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    /** 当前消息的类型标识。 */
    const messageType = (message as { type?: string } | undefined)?.type;

    if (messageType === RUNTIME_MSG_RULE_HIT) {
      /** 只接受由标签页内容脚本发出的命中上报。 */
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return undefined;
      }
      applyRuleHits(tabId, parseHits((message as { hits?: unknown }).hits));
      return undefined;
    }

    if (
      messageType === RUNTIME_MSG_GET_RULE_HIT_SUMMARY ||
      messageType === RUNTIME_MSG_CLEAR_RULE_HITS
    ) {
      /** popup 显式传入的当前标签页 ID。 */
      const requestedTabId = Number((message as { tabId?: unknown }).tabId);
      if (!Number.isInteger(requestedTabId) || requestedTabId < 0) {
        return undefined;
      }
      if (messageType === RUNTIME_MSG_CLEAR_RULE_HITS) {
        clearHits(requestedTabId);
        setActionIconState(requestedTabId, false);
      }
      return Promise.resolve(getHitSummary(requestedTabId));
    }

    if (messageType === RUNTIME_MSG_GET_SCOPE_CONTEXT) {
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

  // 标签生命周期与位置变化都会改变作用域对应的 tabId 集合，去抖重算规则集
  browser.tabs.onCreated.addListener(() => scheduleResync());
  browser.tabs.onRemoved.addListener((tabId) => {
    scheduleResync();
    dropTab(tabId);
    forgetTab(tabId);
  });
  browser.tabs.onMoved.addListener(() => scheduleResync());
  browser.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
    scheduleResync();
    dropTab(removedTabId);
    forgetTab(removedTabId);
  });
  browser.tabs.onAttached.addListener((tabId) => {
    scheduleResync();
    // 跨窗口移动后，窗口作用域需要用新 windowId 重新过滤页面侧规则
    void pushScopeContext(tabId);
  });
  browser.tabs.onDetached.addListener(() => scheduleResync());
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // groupId 变化（移入 / 移出分组）既影响 session 规则，也需要下发给页面侧刷新分组作用域过滤。
    // groupId 不在 onUpdated changeInfo 的类型声明里但运行时可能出现，故经 unknown 取值。
    if ((changeInfo as unknown as { groupId?: number }).groupId !== undefined) {
      scheduleResync();
      void pushScopeContext(tabId);
    }
  });

  // 标签组自身的增删改（如整组移动）也可能改变分组内标签集合，需重算 session 规则
  if (browser.tabGroups) {
    browser.tabGroups.onCreated.addListener(() => scheduleResync());
    browser.tabGroups.onRemoved.addListener(() => scheduleResync());
    browser.tabGroups.onUpdated.addListener(() => scheduleResync());
    browser.tabGroups.onMoved.addListener(() => scheduleResync());
  }
});
