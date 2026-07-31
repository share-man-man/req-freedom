import { browser } from 'wxt/browser';
import type { RuleHit, RuleHitLog, RuleHitSummary, RuleHitTabSummary } from '@req-freedom/shared';
import { STORAGE_KEY_RULE_HITS } from '@req-freedom/shared';
import {
  appendHits,
  createTabHitLog,
  getLastHitAt,
  getRuleHitsMirrorKey,
  hasAppliedHit,
  MAX_TRACKED_TABS,
  mergeRestoredHits,
  summarizeHits,
  type TabHitLog,
} from './rule-hit';
import { queryAllTabs } from './scope';

/** 镜像写回 storage.session 的防抖窗口。 */
const MIRROR_DEBOUNCE_MS = 1000;

/**
 * 命中日志的权威存储。
 *
 * 内存是权威、storage.session 只是镜像：命中是逐请求写入的，若以 storage 为权威，
 * 每条命中都要全量序列化整个数组，一次页面加载的开销退化为 O(n²)。
 */
const hitsByTab = new Map<number, TabHitLog>();

/** 自上次镜像以来发生过变化的标签页。 */
const dirtyTabIds = new Set<number>();

/** 当前待触发的镜像写回定时器。 */
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;

/** 冷启动恢复是否已结束；结束后镜像不会再被读回内存。 */
let restoreSettled = false;

/**
 * 恢复结束前被改动过的标签页。
 *
 * 恢复读取是异步的，其结果可能晚于「清空」到达：清空只把标签页从内存移除，
 * 而 mergeRestoredHits 判定「内存中不存在」就会回填，旧日志因此复活。登记改动过的
 * 标签页即可让恢复跳过它们。恢复结束后这份登记不再有用，随即清空以免无界增长。
 */
const mutatedTabIds = new Set<number>();

/**
 * 把标记为脏的标签页日志写回镜像。
 */
async function flushMirror(): Promise<void> {
  mirrorTimer = undefined;
  /** 本轮需要写回或删除的标签页。 */
  const pending = [...dirtyTabIds];
  dirtyTabIds.clear();
  if (pending.length === 0) {
    return;
  }
  /** 本轮需要整体写入的镜像条目。 */
  const updates: Record<string, TabHitLog> = {};
  /** 本轮需要删除的镜像键（标签页已关闭或日志被清空）。 */
  const removals: string[] = [];
  for (const tabId of pending) {
    /** 当前标签页的内存日志。 */
    const log = hitsByTab.get(tabId);
    if (log && log.hits.length > 0) {
      updates[getRuleHitsMirrorKey(tabId)] = log;
    } else {
      removals.push(getRuleHitsMirrorKey(tabId));
    }
  }
  try {
    if (removals.length > 0) {
      await browser.storage.session.remove(removals);
    }
    if (Object.keys(updates).length > 0) {
      await browser.storage.session.set(updates);
    }
  } catch (error) {
    console.error('[req-freedom] 写回命中日志镜像失败：', error);
  }
}

/**
 * 标记标签页为脏并安排一次防抖镜像写回。
 *
 * 命中事件本身会重置 Service Worker 的 30 秒空闲计时器，因此 1 秒防抖不会被空闲终止追上。
 * @param tabId 发生变化的标签页
 */
function scheduleMirror(tabId: number): void {
  dirtyTabIds.add(tabId);
  if (mirrorTimer === undefined) {
    mirrorTimer = setTimeout(() => void flushMirror(), MIRROR_DEBOUNCE_MS);
  }
}

/**
 * 登记标签页在冷启动恢复完成前被改动过。
 * @param tabId 被改动的标签页
 */
function markMutated(tabId: number): void {
  if (!restoreSettled) {
    mutatedTabIds.add(tabId);
  }
}

/**
 * 丢弃最久未更新的标签页日志，直到标签页数量不超过上限。
 *
 * 按整个标签页淘汰，而不是跨标签页削减条数：popup 只读当前标签页，整体丢弃是可解释的
 * （那个标签页的统计被回收了），跨标签页削减则会让某个标签页的数字变成静默的半截。
 * hitsByTab 的迭代顺序即插入顺序，而每次改动都会重新插入，因此队首就是最久未更新的标签页。
 */
function evictOverflow(): void {
  while (hitsByTab.size > MAX_TRACKED_TABS) {
    /** 当前最久未更新的标签页。 */
    const oldest = hitsByTab.keys().next();
    if (oldest.done) {
      return;
    }
    hitsByTab.delete(oldest.value);
    markMutated(oldest.value);
    scheduleMirror(oldest.value);
  }
}

/**
 * 修改某个标签页的命中日志，并同步维护镜像、恢复登记与标签页数量上限。
 *
 * 所有改动内存的路径都必须经由此函数。内存是权威、镜像是副本，二者的同步此前依赖
 * 每个调用点自己记得调用 scheduleMirror，`clearHits` 就曾因少了这一步而在 Service Worker
 * 冷启动窗口内清空失效。这里把「改内存」「打脏标记」「登记已改动」「超额淘汰」绑成一个
 * 不可分割的动作。
 * @param tabId 目标标签页
 * @param nextLog 依据当前日志算出的新日志；返回 undefined 表示删除该标签页的日志
 */
function mutateLog(
  tabId: number,
  nextLog: (log: TabHitLog | undefined) => TabHitLog | undefined,
): void {
  /** 改动后的日志；undefined 代表该标签页不再有日志。 */
  const next = nextLog(hitsByTab.get(tabId));
  // 先删后插：Map 的迭代顺序即插入顺序，重新插入使其等价于「最近改动顺序」，超额淘汰据此取队首。
  hitsByTab.delete(tabId);
  if (next) {
    hitsByTab.set(tabId, next);
  }
  markMutated(tabId);
  scheduleMirror(tabId);
  evictOverflow();
}

/**
 * 记录一批命中。
 *
 * 全程同步：Service Worker 单线程且此处无 await，天然不会与其他事件交错，
 * 因此不需要按标签页的串行写队列。
 * @param tabId 命中发生的标签页
 * @param hits 本次产生的命中
 */
export function recordHits(tabId: number, hits: readonly RuleHit[]): void {
  if (tabId >= 0 && hits.length > 0) {
    mutateLog(tabId, (log) => appendHits(log ?? createTabHitLog(), hits));
  }
}

/**
 * 清空某个标签页的命中日志。
 * @param tabId 标签页 ID
 */
export function clearHits(tabId: number): void {
  mutateLog(tabId, () => undefined);
}

/**
 * 丢弃已关闭标签页的命中日志与镜像。
 *
 * 存储层的动作与 clearHits 完全相同，保留独立入口只为在调用点区分「导航重置」与「标签关闭」。
 * @param tabId 标签页 ID
 */
export function dropTab(tabId: number): void {
  mutateLog(tabId, () => undefined);
}

/**
 * 读取某个标签页的命中摘要。
 * @param tabId 标签页 ID
 * @returns 命中过的业务规则 ID 与截断标记
 */
export function getHitSummary(tabId: number): RuleHitSummary {
  return summarizeHits(hitsByTab.get(tabId));
}

/**
 * 读取某个标签页的完整命中日志。
 *
 * 请求日志视图要逐条展示「哪条规则命中了哪个请求」，摘要（去重后的规则 ID）不够用，
 * 因此单独提供一个返回原始日志的入口。
 * @param tabId 标签页 ID
 * @returns 该标签页的命中日志；无记录时为空日志
 */
export function getHitLog(tabId: number): RuleHitLog {
  return hitsByTab.get(tabId) ?? createTabHitLog();
}

/**
 * 列出当前仍保有命中日志的标签页概览。
 *
 * 请求日志视图据此列出可查看的标签页；按最后一条命中的时间倒序，最近活跃的排在最前。
 * @returns 标签页概览列表
 */
export function listHitTabs(): RuleHitTabSummary[] {
  return [...hitsByTab.entries()]
    .map(([tabId, log]) => ({ tabId, total: log.hits.length, lastHitAt: getLastHitAt(log) }))
    .filter((summary) => summary.total > 0)
    .sort((left, right) => right.lastHitAt - left.lastHitAt);
}

/**
 * 判断某个标签页当前是否有规则实际生效过。
 *
 * 徽标据此点亮，因此判据是「有规则生效」而不是「日志非空」：只匹配上、未能应用的记录
 * 也在日志里（popup 要据此解释原因），但它们不代表有规则生效。
 * @param tabId 标签页 ID
 * @returns 存在至少一条已执行的命中时为 true
 */
export function hasAppliedHits(tabId: number): boolean {
  return hasAppliedHit(hitsByTab.get(tabId));
}

/**
 * 按最后一条命中的时间重排内存日志，使迭代顺序恢复为「最近改动顺序」。
 *
 * 仅在冷启动恢复后调用：此时 Map 里混着镜像读回的条目与重启后已记录的新命中，
 * 两者的插入顺序都不代表活跃度。
 */
function reorderByRecency(): void {
  /** 按活跃度升序排列的全部条目。 */
  const ordered = [...hitsByTab.entries()].sort(
    ([, left], [, right]) => getLastHitAt(left) - getLastHitAt(right),
  );
  hitsByTab.clear();
  for (const [tabId, log] of ordered) {
    hitsByTab.set(tabId, log);
  }
}

/**
 * 查询当前存活的标签页 ID，用于回收孤儿日志。
 *
 * 查询失败时返回 undefined 表示「本轮无法对账」：宁可留下孤儿，也不能因为一次查询失败
 * 就删掉正常标签页的日志。
 * @returns 存活标签页 ID 集合；查询失败时为 undefined
 */
async function queryLiveTabIds(): Promise<Set<number> | undefined> {
  try {
    /** 当前全部标签页。 */
    const tabs = await queryAllTabs();
    return new Set(tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])));
  } catch (error) {
    console.error('[req-freedom] 查询存活标签页失败，本轮跳过孤儿日志回收：', error);
    return undefined;
  }
}

/**
 * 从 storage.session 镜像恢复内存日志。
 *
 * 只填充内存中缺失、且恢复期间未被改动过的标签页，避免恢复结果冲掉 Service Worker
 * 重启后已记录的新命中或已经发生的清空。
 *
 * 同时回收孤儿日志：标签页关闭通常会唤醒 Service Worker 并派发 tabs.onRemoved，但该事件
 * 也可能因崩溃或扩展更新的事件真空期而丢失，此后镜像里的那条记录再也等不到自己的
 * onRemoved。冷启动本就要读镜像，顺带与存活标签页对账即可就地回收；Service Worker 空闲
 * 30 秒即终止，因此孤儿的实际存活时间很短。
 * @returns 恢复完成后的 Promise
 */
export async function restoreHits(): Promise<void> {
  try {
    /** 镜像条目与存活标签页并行读取，冷启动只多一次标签查询。 */
    const [stored, liveTabIds] = await Promise.all([
      browser.storage.session.get(null),
      queryLiveTabIds(),
    ]);
    /** 从镜像键还原出的标签页日志。 */
    const restored: [number, TabHitLog][] = [];
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(`${STORAGE_KEY_RULE_HITS}:`)) {
        continue;
      }
      /** 镜像键中携带的标签页 ID。 */
      const tabId = Number(key.slice(STORAGE_KEY_RULE_HITS.length + 1));
      /** 镜像中保存的日志结构。 */
      const log = value as Partial<TabHitLog> | undefined;
      if (!Number.isInteger(tabId) || !Array.isArray(log?.hits)) {
        continue;
      }
      if (liveTabIds && !liveTabIds.has(tabId)) {
        // 标签页已不存在，它的 onRemoved 永远不会再来；走同一条改动路径就地回收，镜像键随之删除
        dropTab(tabId);
        continue;
      }
      restored.push([tabId, { hits: log.hits, truncated: Boolean(log.truncated) }]);
    }
    mergeRestoredHits(hitsByTab, restored, mutatedTabIds);
    // 恢复后按活跃度重排：镜像读回的顺序与最近改动无关，重排后队首才真的是最久未更新的标签页。
    reorderByRecency();
    evictOverflow();
  } catch (error) {
    console.error('[req-freedom] 恢复命中日志镜像失败：', error);
  } finally {
    // 恢复结束后镜像不会再被读回，登记随即失效；失败路径同样置位，避免登记无界增长。
    restoreSettled = true;
    mutatedTabIds.clear();
  }
}

/**
 * 列出当前内存中有规则生效过的标签页。
 *
 * 冷启动恢复后据此补回徽标，判据与 recordHits 之后的刷新保持一致。
 * @returns 标签页 ID 列表
 */
export function listTabsWithAppliedHits(): number[] {
  return [...hitsByTab.keys()].filter((tabId) => hasAppliedHits(tabId));
}
