import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type {
  Rule,
  RuleMatchCount,
  RuleMatchSummary,
  ScopeContext,
} from '@req-freedom/shared';
import {
  DNR_RULE_ID_OFFSET,
  RUNTIME_MSG_CLEAR_RULE_MATCHES,
  RUNTIME_MSG_GET_RULE_MATCH_SUMMARY,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_RULE_MATCH_DOCUMENT_STARTED,
  RUNTIME_MSG_RULE_MATCHED,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  STORAGE_KEY_DNR_RULE_ID_REGISTRY,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_RULE_MATCH_STATE,
} from '@req-freedom/shared';
import { collectActiveRules, isRuleScoped } from '@req-freedom/core';
import { toCompiledDnrRules } from '@/utils/dnr';
import {
  createDnrRuleIdLookup,
  ensureDnrRuleIdRegistry,
  parseDnrRuleIdRegistry,
  type DnrRuleIdRegistry,
  type DnrRuleIdentityDescriptor,
} from '@/utils/dnr-rule-registry';
import {
  countRuleActions,
  mergeRuleMatchCounts,
  parseRuleMatchCounts,
  subtractRuleMatchCounts,
  sumRuleMatchCounts,
} from '@/utils/rule-match-counts';
import {
  applyPagePatchRuleCounts,
  clearRuleMatchState,
  createNavigatedRuleMatchState,
  normalizeTabRuleMatchState,
  registerRuleMatchDocumentState,
  type TabRuleMatchState,
} from '@/utils/rule-match-state';
import { queryAllTabs, resolveScopeTabIds } from '@/utils/scope';
import { getEnabled, getGroups } from '@/utils/storage';

/** 由业务规则转换出的、非空的 DNR 规则 */
type DnrRule = ReturnType<typeof toCompiledDnrRules>[number]['dnrRule'];

/** updateDynamicRules / updateSessionRules 共用的更新入参。 */
type DnrUpdateArg = { removeRuleIds?: number[]; addRules?: DnrRule[] };

/** 一条业务规则与其对应的 DNR 规则的配对，便于失败时定位到源规则 */
interface DnrEntry {
  /** 源业务规则，仅用于日志定位 */
  rule: Rule;
  /** 转换后的 DNR 规则 */
  dnrRule: DnrRule;
}

/** DNR 数字规则 ID 到业务规则 ID 的全局持久化身份映射。 */
let dnrRuleIdLookup = new Map<number, string>();

/** background 冷启动时 DNR 持久化身份注册表与两套规则集的初始化任务。 */
let dnrRuleRegistryReady: Promise<unknown> = Promise.resolve();

/** 各标签页独立的状态操作队列，避免同一标签页的记录、清空和导航重置交错。 */
const tabRuleMatchMutations = new Map<number, Promise<unknown>>();

/**
 * 返回单个标签页独立的 storage.session 状态键。
 * @param tabId 标签页 ID
 * @returns 当前标签页的状态键
 */
function getTabRuleMatchStateKey(tabId: number): string {
  return `${STORAGE_KEY_RULE_MATCH_STATE}:${tabId}`;
}

/**
 * 读取单个标签页的命中状态，并兼容尚未迁移的聚合旧键。
 * @param tabId 标签页 ID
 * @returns 当前标签页的标准化状态
 */
async function readTabRuleMatchState(tabId: number): Promise<TabRuleMatchState> {
  /** 当前标签页独立状态的 storage.session 键。 */
  const stateKey = getTabRuleMatchStateKey(tabId);
  /** 新旧两种存储结构的一次性读取结果。 */
  const result = await browser.storage.session.get([stateKey, STORAGE_KEY_RULE_MATCH_STATE]);
  /** 当前标签页独立存储的新状态。 */
  const stored = result[stateKey];
  if (stored && typeof stored === 'object') {
    return normalizeTabRuleMatchState(stored as TabRuleMatchState);
  }
  /** 旧版按全部标签页聚合的状态。 */
  const legacyStates = result[STORAGE_KEY_RULE_MATCH_STATE];
  if (legacyStates && typeof legacyStates === 'object') {
    return normalizeTabRuleMatchState(
      (legacyStates as Record<string, TabRuleMatchState>)[String(tabId)],
    );
  }
  return normalizeTabRuleMatchState(undefined);
}

/**
 * 直接写入单个标签页的独立命中状态。
 * @param tabId 标签页 ID
 * @param state 待持久化的完整状态
 */
async function writeTabRuleMatchState(
  tabId: number,
  state: TabRuleMatchState,
): Promise<void> {
  await browser.storage.session.set({
    [getTabRuleMatchStateKey(tabId)]: state,
  });
}

/**
 * 在单个标签页队列中串行执行状态相关操作。
 * @param tabId 标签页 ID
 * @param operation 待串行执行的操作
 * @returns 当前操作的结果
 */
function enqueueTabRuleMatchOperation<T>(
  tabId: number,
  operation: () => Promise<T>,
): Promise<T> {
  /** 当前标签页上一项操作，失败也不阻塞后续恢复。 */
  const previous = tabRuleMatchMutations.get(tabId) ?? Promise.resolve();
  /** 排在上一项之后执行的新操作。 */
  const mutation = previous.catch(() => undefined).then(operation);
  /** 带完成清理逻辑、实际写入队列 Map 的 Promise。 */
  const trackedMutation = mutation.finally(() => {
    if (tabRuleMatchMutations.get(tabId) === trackedMutation) {
      tabRuleMatchMutations.delete(tabId);
    }
  });
  tabRuleMatchMutations.set(tabId, trackedMutation);
  return mutation;
}

/**
 * 等待当前标签页已排队写入完成后读取状态。
 * @param tabId 标签页 ID
 * @returns 当前标签页的标准化状态
 */
async function getTabRuleMatchState(tabId: number): Promise<TabRuleMatchState> {
  await tabRuleMatchMutations.get(tabId)?.catch(() => undefined);
  return readTabRuleMatchState(tabId);
}

/**
 * 调整当前标签页的浏览器原生动作计数。
 * @param tabId 目标标签页 ID
 * @param increment 动作计数增量；负数用于清空已有计数
 */
async function incrementNativeActionCount(tabId: number, increment: number): Promise<void> {
  if (increment === 0) {
    return;
  }
  await browser.declarativeNetRequest.setExtensionActionOptions({
    tabUpdate: { tabId, increment },
  });
}

/**
 * 记录页面补丁通道实际采用的动作，并累加浏览器原生动作计数。
 * @param tabId 命中发生的标签页
 * @param ruleCounts 按业务规则归并的实际动作数量
 */
async function recordPagePatchMatch(
  tabId: number,
  documentToken: string,
  ruleCounts: RuleMatchCount[],
): Promise<void> {
  await enqueueTabRuleMatchOperation(tabId, async () => {
    /** 当前标签页写入前的完整状态。 */
    const previous = await readTabRuleMatchState(tabId);
    /** 仅在 token 属于当前 Document 时产生的状态变更。 */
    const applied = applyPagePatchRuleCounts(previous, documentToken, ruleCounts);
    if (!applied) {
      return;
    }
    await writeTabRuleMatchState(tabId, applied.state);
    try {
      await incrementNativeActionCount(tabId, applied.increment);
    } catch (error) {
      // 原生计数失败时回滚已写入明细，尽量维持 popup 与工具栏徽标一致。
      await writeTabRuleMatchState(tabId, {
        ...applied.state,
        pagePatchRuleCounts: subtractRuleMatchCounts(
          applied.state.pagePatchRuleCounts,
          ruleCounts,
        ),
      }).catch((rollbackError) => {
        console.error('[req-freedom] 回滚页面补丁动作明细失败：', rollbackError);
      });
      throw error;
    }
  });
}

/**
 * 注册 bridge 为当前顶层 Document 生成的实例标识。
 * @param tabId 标签页 ID
 * @param documentToken bridge 私有 Document token
 */
async function registerRuleMatchDocument(
  tabId: number,
  documentToken: string,
): Promise<void> {
  await enqueueTabRuleMatchOperation(tabId, async () => {
    /** 当前导航窗口状态。 */
    const state = await readTabRuleMatchState(tabId);
    if (state.documentToken === documentToken) {
      return;
    }
    await writeTabRuleMatchState(
      tabId,
      registerRuleMatchDocumentState(state, documentToken),
    );
  });
}

/**
 * 在顶层导航开始时创建新的动作统计窗口。
 * @param tabId 标签页 ID
 * @param since webNavigation 提供的导航开始时间
 */
async function resetRuleMatchDocument(tabId: number, since: number): Promise<void> {
  await enqueueTabRuleMatchOperation(tabId, () =>
    writeTabRuleMatchState(tabId, createNavigatedRuleMatchState(since)),
  );
}

/**
 * 把浏览器返回的 DNR 动作明细按业务规则归并。
 * @param matches 当前统计窗口内的 DNR 原生动作明细
 * @returns 能还原到业务规则的逐规则 DNR 动作计数
 */
function countDnrRuleMatches(
  matches: Browser.declarativeNetRequest.MatchedRuleInfo[],
): RuleMatchCount[] {
  /** 每条原生 DNR 动作对应的业务规则 ID。 */
  const matchedRuleIds = matches
    .map((match) => dnrRuleIdLookup.get(match.rule.ruleId))
    .filter((ruleId): ruleId is string => typeof ruleId === 'string');
  return countRuleActions(matchedRuleIds);
}

/**
 * 根据状态与 DNR 原生明细构造统一动作摘要。
 * @param state 当前标签页页面补丁状态
 * @param dnrMatches 当前统计窗口内的 DNR 原生明细
 * @returns DNR 与页面补丁的动作总数及逐规则计数
 */
function createRuleMatchSummary(
  state: TabRuleMatchState,
  dnrMatches: Browser.declarativeNetRequest.MatchedRuleInfo[],
): RuleMatchSummary {
  /** 按业务规则归并的 DNR 原生动作计数。 */
  const dnrRuleCounts = countDnrRuleMatches(dnrMatches);
  /** 能还原到业务规则的 DNR 动作数量。 */
  const mappedDnrCount = sumRuleMatchCounts(dnrRuleCounts);
  /** 两条执行通道合并后的逐规则动作计数。 */
  const ruleCounts = mergeRuleMatchCounts(dnrRuleCounts, state.pagePatchRuleCounts);
  return {
    count: dnrMatches.length + sumRuleMatchCounts(state.pagePatchRuleCounts),
    ruleCounts,
    unmappedCount: Math.max(0, dnrMatches.length - mappedDnrCount),
  };
}

/**
 * 读取当前标签页由浏览器原生动作计数统一承载的规则摘要。
 * @param tabId 目标标签页 ID
 * @returns DNR 与页面补丁的动作总数及逐规则计数
 */
async function getRuleMatchSummary(tabId: number): Promise<RuleMatchSummary> {
  // Service Worker 冷启动时先建立稳定 DNR ID 映射，再读取浏览器保留的动作明细。
  await dnrRuleRegistryReady;
  const state = await getTabRuleMatchState(tabId);
  /** 当前统计窗口内由浏览器记录的 DNR 原生动作明细。 */
  const dnrMatches = await browser.declarativeNetRequest.getMatchedRules({
    tabId,
    minTimeStamp: state.since,
  });
  return createRuleMatchSummary(state, dnrMatches.rulesMatchedInfo);
}

/**
 * 清空当前标签页两条通道的命中状态与扩展图标计数。
 * @param tabId 标签页 ID
 * @returns 清空后的零值摘要
 */
async function clearRuleMatches(tabId: number): Promise<RuleMatchSummary> {
  return enqueueTabRuleMatchOperation(tabId, async () => {
    await dnrRuleRegistryReady;
    /** 清空动作的精确时间边界；边界后的 DNR 动作继续归入新窗口。 */
    const clearStartedAt = Date.now();
    /** 清空前当前标签页的页面补丁状态。 */
    const state = await readTabRuleMatchState(tabId);
    /** 浏览器返回的当前窗口 DNR 原生动作，可能包含清空开始后的新动作。 */
    const matchedRules = await browser.declarativeNetRequest.getMatchedRules({
      tabId,
      minTimeStamp: state.since,
    });
    /** 严格早于清空边界、应从原生计数中扣除的 DNR 动作。 */
    const dnrMatches = matchedRules.rulesMatchedInfo.filter(
      (match) => match.timeStamp < clearStartedAt,
    );
    /** 清空前由两条通道构成的动作摘要。 */
    const summary = createRuleMatchSummary(state, dnrMatches);
    await incrementNativeActionCount(tabId, -summary.count);
    try {
      await writeTabRuleMatchState(
        tabId,
        clearRuleMatchState(state, clearStartedAt),
      );
    } catch (error) {
      // 状态重置失败时恢复刚扣除的原生计数，避免出现徽标清空但 popup 明细仍存在。
      await incrementNativeActionCount(tabId, summary.count).catch((rollbackError) => {
        console.error('[req-freedom] 恢复清空前原生动作计数失败：', rollbackError);
      });
      throw error;
    }
    return { count: 0, ruleCounts: [], unmappedCount: 0 };
  });
}

/**
 * 把业务规则列表编译成 DNR entries，为每个业务规则动作分配稳定 DNR ID。
 * @param rules 待编译的业务规则（应已按通道 / 作用域筛选）
 * @param tabIdsByRuleId 各规则作用域解析出的 tabId 列表（仅 session 规则需要）
 * @returns 「业务规则 → DNR 规则」配对列表
 */
function compileEntries(
  rules: Rule[],
  registry: DnrRuleIdRegistry,
  tabIdsByRuleId?: Map<string, number[]>,
): DnrEntry[] {
  /** 待注册的配对列表。 */
  const entries: DnrEntry[] = [];
  for (const rule of rules) {
    /** 当前规则作用域解析出的目标 tabId（无作用域时为 undefined）。 */
    const tabIds = tabIdsByRuleId?.get(rule.id);
    /** 当前业务规则编译出的全部网络层动作。 */
    const compiledRules = toCompiledDnrRules(rule, DNR_RULE_ID_OFFSET, tabIds);
    entries.push(
      ...compiledRules.map((compiledRule) => {
        /** 当前业务动作已经持久化的 DNR 数字身份。 */
        const identity = registry.entries[compiledRule.actionKey];
        if (!identity) {
          throw new Error(`DNR 动作身份尚未注册：${compiledRule.actionKey}`);
        }
        return {
          rule,
          dnrRule: {
            ...compiledRule.dnrRule,
            id: identity.dnrRuleId,
          },
        };
      }),
    );
  }
  return entries;
}

/**
 * 收集完整规则目录中的 DNR 动作身份描述。
 * @param rules 包含停用规则在内的完整规则目录
 * @returns 用于补齐持久化注册表的动作身份
 */
function collectDnrRuleIdentityDescriptors(
  rules: readonly Rule[],
): DnrRuleIdentityDescriptor[] {
  return rules.flatMap((rule) =>
    toCompiledDnrRules(rule, DNR_RULE_ID_OFFSET).map((compiledRule) => ({
      actionKey: compiledRule.actionKey,
      legacyKey: compiledRule.legacyKey,
      ruleId: rule.id,
    })),
  );
}

/**
 * 读取并补齐 DNR 动作身份注册表，同时刷新内存查询表。
 * @param allRules 包含停用规则在内的完整规则目录
 * @returns 已覆盖当前目录及历史 tombstone 的注册表
 */
async function prepareDnrRuleIdRegistry(
  allRules: readonly Rule[],
): Promise<DnrRuleIdRegistry> {
  /** storage.local 中的注册表原始值。 */
  const stored = await browser.storage.local.get(STORAGE_KEY_DNR_RULE_ID_REGISTRY);
  /** 校验后的当前注册表。 */
  const current = parseDnrRuleIdRegistry(stored[STORAGE_KEY_DNR_RULE_ID_REGISTRY]);
  /** 补齐当前规则目录动作身份后的结果。 */
  const ensured = ensureDnrRuleIdRegistry(
    current,
    collectDnrRuleIdentityDescriptors(allRules),
  );
  if (ensured.changed) {
    await browser.storage.local.set({
      [STORAGE_KEY_DNR_RULE_ID_REGISTRY]: ensured.registry,
    });
  }
  dnrRuleIdLookup = createDnrRuleIdLookup(ensured.registry);
  return ensured.registry;
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
): Promise<DnrEntry[]> {
  /** 当前已注册的规则，用于全量清除。 */
  const existing = await getRules();
  /** 需要移除的规则 ID 列表。 */
  const removeRuleIds = existing.map((rule) => rule.id);
  /** 需要新增的 DNR 规则列表。 */
  const addRules = entries.map((entry) => entry.dnrRule);
  try {
    await update({ removeRuleIds, addRules });
    return entries;
  } catch (error) {
    console.error(`[req-freedom] 整批同步 ${label} DNR 规则失败，降级为逐条注册以隔离非法规则：`, error);
    // 先整批清除旧规则（仅移除、不新增，通常不会失败）
    try {
      await update({ removeRuleIds });
    } catch (removeError) {
      console.error(`[req-freedom] 清除旧 ${label} DNR 规则失败：`, removeError);
    }
    // 再逐条添加，非法规则单独失败并跳过，合法规则照常生效
    /** 降级后确认已成功注册的 entries。 */
    const registeredEntries: DnrEntry[] = [];
    for (const entry of entries) {
      /** 当前尝试注册的业务规则。 */
      const { rule, dnrRule } = entry;
      try {
        await update({ addRules: [dnrRule] });
        registeredEntries.push(entry);
      } catch (addError) {
        console.warn(`[req-freedom] 规则「${rule.name}」非法，已跳过（其余规则不受影响）：`, addError);
      }
    }
    return registeredEntries;
  }
}

/**
 * 读取当前生效规则（全局停用时视为空）
 * @returns 当前生效的业务规则列表
 */
async function getRuleCatalog(): Promise<{ allRules: Rule[]; activeRules: Rule[] }> {
  /** 全局开关状态。 */
  const enabled = await getEnabled();
  /** 全部规则分组。 */
  const groups = await getGroups();
  /** 包含停用分组和停用规则在内的完整规则目录。 */
  const allRules = groups.flatMap((group) => group.rules);
  return {
    allRules,
    activeRules: enabled ? collectActiveRules(groups) : [],
  };
}

/**
 * 同步「全部标签页」作用域的 DNR 动态规则
 *
 * 动态规则可跨浏览器重启保留，承载不限定作用范围的规则；限定作用域的规则改走 session 规则。
 */
async function syncDynamicRules(
  activeRules: readonly Rule[],
  registry: DnrRuleIdRegistry,
): Promise<void> {
  /** 当前生效且不限定作用域的规则。 */
  const unscopedRules = activeRules.filter((rule) => !isRuleScoped(rule));
  /** 当前动态规则编译结果。 */
  const entries = compileEntries(unscopedRules, registry);
  await commitDnr(
    () => browser.declarativeNetRequest.getDynamicRules(),
    (arg) => browser.declarativeNetRequest.updateDynamicRules(arg),
    entries,
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
async function syncSessionRules(
  activeRules: readonly Rule[],
  registry: DnrRuleIdRegistry,
): Promise<void> {
  /** 当前生效且限定了作用域的规则。 */
  const scopedRules = activeRules.filter(isRuleScoped);
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
  /** 当前 session 规则编译结果。 */
  const entries = compileEntries(registrableRules, registry, tabIdsByRuleId);
  await commitDnr(
    () => browser.declarativeNetRequest.getSessionRules(),
    (arg) => browser.declarativeNetRequest.updateSessionRules(arg),
    entries,
    'session',
  );
}

/**
 * 串行同步动态与 session 两套 DNR 规则及其业务 ID 映射。
 *
 * 任一规则集的瞬时失败不会让另一套映射或后续同步永久失效；后续 storage / 标签事件
 * 仍可继续排队恢复。
 * @returns 本轮同步完成后的 Promise
 */
function syncDnrRuleSets(): Promise<void> {
  /** 排在上一轮同步之后执行的本轮同步任务。 */
  const synchronization = dnrRuleRegistryReady.then(async () => {
    /** 本轮动态与 session 同步共享的同一份规则目录快照。 */
    const catalog = await getRuleCatalog();
    /** 覆盖完整规则目录和历史动作的持久化身份注册表。 */
    const registry = await prepareDnrRuleIdRegistry(catalog.allRules);
    /** 两套 DNR 规则集各自的同步结果。 */
    const results = await Promise.allSettled([
      syncDynamicRules(catalog.activeRules, registry),
      syncSessionRules(catalog.activeRules, registry),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[req-freedom] 同步 DNR 规则集失败：', result.reason);
      }
    }
  });
  dnrRuleRegistryReady = synchronization.catch(() => undefined);
  return synchronization;
}

/**
 * 串行重算仅受标签生命周期影响的 session DNR 规则。
 * @returns 本轮 session 规则同步完成后的 Promise
 */
function syncDnrSessionRules(): Promise<void> {
  /** 排在上一轮同步之后执行的 session 规则同步任务。 */
  const synchronization = dnrRuleRegistryReady.then(async () => {
    try {
      /** session 同步使用的完整规则目录快照。 */
      const catalog = await getRuleCatalog();
      /** 与动态规则共享的持久化身份注册表。 */
      const registry = await prepareDnrRuleIdRegistry(catalog.allRules);
      await syncSessionRules(catalog.activeRules, registry);
    } catch (error) {
      console.error('[req-freedom] 同步 session DNR 规则集失败：', error);
    }
  });
  dnrRuleRegistryReady = synchronization.catch(() => undefined);
  return synchronization;
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
    void syncDnrSessionRules();
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
  // 徽标统一显示浏览器原生动作计数；页面补丁动作通过 tabUpdate 增量并入同一计数器。
  void browser.action.setBadgeBackgroundColor({ color: '#7c3aed' }).catch((error) => {
    console.error('[req-freedom] 设置动作徽标颜色失败：', error);
  });
  void browser.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: true,
  }).catch((error) => {
    console.error('[req-freedom] 启用原生动作徽标失败：', error);
  });

  // 启动时同步两套 DNR 规则，并建立原生数字规则 ID 到业务规则 ID 的稳定映射。
  void syncDnrRuleSets().catch((error) => {
    console.error('[req-freedom] 初始化 DNR 规则集失败：', error);
  });

  // 规则或全局开关变化时，动态与 session 规则都要重新同步
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

  // 桥接脚本请求自身标签上下文：从 sender.tab 读取后回传（内容脚本拿不到自己的 tabId）
  browser.runtime.onMessage.addListener((message, sender) => {
    /** 当前消息的类型标识。 */
    const messageType = (message as { type?: string } | undefined)?.type;
    if (messageType === RUNTIME_MSG_RULE_MATCH_DOCUMENT_STARTED) {
      /** 只接受标签页 bridge 注册的 Document token。 */
      const tabId = sender.tab?.id;
      /** bridge 生成的私有 Document token。 */
      const documentToken = (message as { documentToken?: unknown }).documentToken;
      if (
        tabId === undefined ||
        typeof documentToken !== 'string' ||
        documentToken.length === 0 ||
        documentToken.length > 128
      ) {
        return undefined;
      }
      return registerRuleMatchDocument(tabId, documentToken).then(() => undefined);
    }
    if (messageType === RUNTIME_MSG_RULE_MATCHED) {
      /** 只接受由标签页内容脚本发出的命中消息。 */
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return undefined;
      }
      /** 页面补丁实际采用、已按业务规则归并的动作计数。 */
      const ruleCounts = parseRuleMatchCounts(
        (message as { ruleCounts?: unknown }).ruleCounts,
      );
      /** 当前动作批次所属的顶层 Document token。 */
      const documentToken = (message as { documentToken?: unknown }).documentToken;
      if (
        ruleCounts.length === 0 ||
        typeof documentToken !== 'string' ||
        documentToken.length === 0 ||
        documentToken.length > 128
      ) {
        return undefined;
      }
      return recordPagePatchMatch(tabId, documentToken, ruleCounts).then(() => undefined);
    }
    if (
      messageType === RUNTIME_MSG_GET_RULE_MATCH_SUMMARY ||
      messageType === RUNTIME_MSG_CLEAR_RULE_MATCHES
    ) {
      /** popup 显式传入的当前标签页 ID。 */
      const requestedTabId = Number((message as { tabId?: unknown }).tabId);
      if (!Number.isInteger(requestedTabId) || requestedTabId < 0) {
        return undefined;
      }
      if (messageType === RUNTIME_MSG_CLEAR_RULE_MATCHES) {
        return clearRuleMatches(requestedTabId);
      }
      return getRuleMatchSummary(requestedTabId);
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

  // 标签生命周期与位置变化都会改变作用域对应的 tabId 集合，去抖重算 session 规则
  browser.tabs.onCreated.addListener(() => scheduleSessionResync());
  browser.tabs.onRemoved.addListener((tabId) => {
    scheduleSessionResync();
    void enqueueTabRuleMatchOperation(
      tabId,
      () => browser.storage.session.remove(getTabRuleMatchStateKey(tabId)),
    ).catch((error) => {
      console.error('[req-freedom] 清理已关闭标签页动作状态失败：', error);
    });
  });
  browser.tabs.onMoved.addListener(() => scheduleSessionResync());
  browser.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
    scheduleSessionResync();
    void enqueueTabRuleMatchOperation(
      removedTabId,
      () => browser.storage.session.remove(getTabRuleMatchStateKey(removedTabId)),
    ).catch((error) => {
      console.error('[req-freedom] 清理已替换标签页动作状态失败：', error);
    });
  });
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

  // 只在顶层 Document 真正开始导航时开启新窗口；Hash 与 SPA 同文档 URL 变化不会触发重置。
  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) {
      return;
    }
    void resetRuleMatchDocument(details.tabId, details.timeStamp);
  });

  // 标签组自身的增删改（如整组移动）也可能改变分组内标签集合，需重算 session 规则
  if (browser.tabGroups) {
    browser.tabGroups.onCreated.addListener(() => scheduleSessionResync());
    browser.tabGroups.onRemoved.addListener(() => scheduleSessionResync());
    browser.tabGroups.onUpdated.addListener(() => scheduleSessionResync());
    browser.tabGroups.onMoved.addListener(() => scheduleSessionResync());
  }
});
