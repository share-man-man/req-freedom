import { browser } from 'wxt/browser';
import type { RuleHit, RuleHitSummary } from '@req-freedom/shared';
import { STORAGE_KEY_RULE_HITS } from '@req-freedom/shared';
import {
  appendHits,
  createTabHitLog,
  mergeRestoredHits,
  summarizeHits,
  type TabHitLog,
} from './rule-hit';

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

/**
 * 返回单个标签页镜像使用的 storage.session 键。
 * @param tabId 标签页 ID
 * @returns 该标签页的镜像键
 */
function getMirrorKey(tabId: number): string {
  return `${STORAGE_KEY_RULE_HITS}:${tabId}`;
}

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
      updates[getMirrorKey(tabId)] = log;
    } else {
      removals.push(getMirrorKey(tabId));
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
 * 记录一批命中。
 *
 * 全程同步：Service Worker 单线程且此处无 await，天然不会与其他事件交错，
 * 因此不需要按标签页的串行写队列。
 * @param tabId 命中发生的标签页
 * @param hits 本次产生的命中
 * @returns 记录后该标签页是否已有命中
 */
export function recordHits(tabId: number, hits: readonly RuleHit[]): boolean {
  if (tabId < 0 || hits.length === 0) {
    return (hitsByTab.get(tabId)?.hits.length ?? 0) > 0;
  }
  /** 当前标签页的命中日志。 */
  const log = hitsByTab.get(tabId) ?? createTabHitLog();
  appendHits(log, hits);
  hitsByTab.set(tabId, log);
  scheduleMirror(tabId);
  return true;
}

/**
 * 清空某个标签页的命中日志。
 * @param tabId 标签页 ID
 */
export function clearHits(tabId: number): void {
  if (!hitsByTab.has(tabId)) {
    return;
  }
  hitsByTab.delete(tabId);
  scheduleMirror(tabId);
}

/**
 * 丢弃已关闭标签页的命中日志与镜像。
 * @param tabId 标签页 ID
 */
export function dropTab(tabId: number): void {
  hitsByTab.delete(tabId);
  scheduleMirror(tabId);
}

/**
 * 读取某个标签页的命中摘要。
 * @param tabId 标签页 ID
 * @returns 总数、逐规则计数与截断标记
 */
export function getHitSummary(tabId: number): RuleHitSummary {
  return summarizeHits(hitsByTab.get(tabId));
}

/**
 * 判断某个标签页当前是否有命中。
 * @param tabId 标签页 ID
 * @returns 存在至少一条命中时为 true
 */
function hasHits(tabId: number): boolean {
  return (hitsByTab.get(tabId)?.hits.length ?? 0) > 0;
}

/**
 * 从 storage.session 镜像恢复内存日志。
 *
 * 只填充内存中缺失的标签页，避免恢复结果冲掉 Service Worker 重启后已记录的新命中。
 * @returns 恢复完成后的 Promise
 */
export async function restoreHits(): Promise<void> {
  try {
    /** 镜像中的全部条目。 */
    const stored = await browser.storage.session.get(null);
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
      restored.push([tabId, { hits: log.hits, truncated: Boolean(log.truncated) }]);
    }
    mergeRestoredHits(hitsByTab, restored);
  } catch (error) {
    console.error('[req-freedom] 恢复命中日志镜像失败：', error);
  }
}

/**
 * 列出当前内存中有命中的标签页。
 * @returns 标签页 ID 列表
 */
export function listTabsWithHits(): number[] {
  return [...hitsByTab.keys()].filter((tabId) => hasHits(tabId));
}
