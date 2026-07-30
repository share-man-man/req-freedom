import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleHit } from '@req-freedom/shared';
import {
  RuleActionType,
  RuleHitOutcome,
  RuleHitSkipReason,
  STORAGE_KEY_RULE_HITS,
} from '@req-freedom/shared';
import { MAX_TRACKED_TABS } from './rule-hit';

/**
 * 由 mock 与用例共享的 storage.session 假实现。
 *
 * 必须用 vi.hoisted 创建：vi.mock 的工厂会被提升到 import 之前执行。
 */
const session = vi.hoisted(() => ({
  /** 假 storage.session 的底层数据。 */
  data: {} as Record<string, unknown>,
  /** 非空时 get 会挂起，直到用例显式放行，用于构造恢复与清空的竞态。 */
  gate: undefined as { promise: Promise<void>; release: () => void } | undefined,
}));

/** 由 mock 与用例共享的 tabs 假实现状态。 */
const tabs = vi.hoisted(() => ({
  /** 当前存活的标签页；undefined 表示查询将失败。 */
  live: undefined as { id: number }[] | undefined,
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: async (): Promise<{ id: number }[]> => {
        if (!tabs.live) {
          throw new Error('tabs.query failed');
        }
        return tabs.live;
      },
    },
    storage: {
      session: {
        get: async (): Promise<Record<string, unknown>> => {
          if (session.gate) {
            await session.gate.promise;
          }
          return { ...session.data };
        },
        set: async (items: Record<string, unknown>): Promise<void> => {
          Object.assign(session.data, items);
        },
        remove: async (keys: string[]): Promise<void> => {
          for (const key of keys) {
            delete session.data[key];
          }
        },
      },
    },
  },
}));

/**
 * 构造一条命中记录。
 * @param ruleId 业务规则 ID
 * @param at 记录时间，用于构造标签页之间的活跃度差异
 * @returns 字段完整的命中记录
 */
function hit(ruleId: string, at = 1): RuleHit {
  return {
    ruleId,
    action: RuleActionType.Block,
    url: 'https://x/api',
    method: 'GET',
    at,
    outcome: RuleHitOutcome.Applied,
  };
}

/**
 * 构造一条「匹配上但未应用」的记录。
 * @param ruleId 业务规则 ID
 * @param at 记录时间
 * @returns 带跳过原因的命中记录
 */
function skippedHit(ruleId: string, at = 1): RuleHit {
  return {
    ...hit(ruleId, at),
    outcome: RuleHitOutcome.Skipped,
    reason: RuleHitSkipReason.SyncXhr,
  };
}

/**
 * 返回某个标签页的镜像键。
 * @param tabId 标签页 ID
 * @returns storage.session 中的镜像键
 */
function mirrorKey(tabId: number): string {
  return `${STORAGE_KEY_RULE_HITS}:${tabId}`;
}

/**
 * 加载一份全新的命中存储。
 *
 * 该模块以模块级单例保存内存日志与恢复登记，用例之间必须重置模块注册表才能互不影响。
 * @returns 全新初始化的存储模块
 */
async function loadStore(): Promise<typeof import('./rule-hit-store')> {
  vi.resetModules();
  return import('./rule-hit-store');
}

/**
 * 让后续的 storage.session.get 挂起。
 */
function holdGet(): void {
  /** 放行 get 的回调。 */
  let release: () => void = () => undefined;
  /** get 需要等待的闸门。 */
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  session.gate = { promise, release };
}

/**
 * 放行被挂起的 storage.session.get。
 */
function releaseGet(): void {
  session.gate?.release();
  session.gate = undefined;
}

/**
 * 触发防抖到期并等待镜像写回完成。
 */
async function flushMirror(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
}

beforeEach(() => {
  session.data = {};
  session.gate = undefined;
  // 用例中出现的标签页默认都存活，孤儿回收只在显式构造的用例里发生。
  tabs.live = [{ id: 7 }, { id: 8 }];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('命中存储的镜像同步', () => {
  it('命中经防抖写回镜像', async () => {
    const store = await loadStore();

    store.recordHits(7, [hit('a')]);
    expect(session.data[mirrorKey(7)]).toBeUndefined();

    await flushMirror();

    expect(session.data[mirrorKey(7)]).toEqual({ hits: [hit('a')], truncated: false });
  });

  it('内存中没有该标签页时，清空仍会删除镜像', async () => {
    // Service Worker 重启后的状态：镜像还在，内存已空。
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    const store = await loadStore();

    store.clearHits(7);
    await flushMirror();

    expect(session.data[mirrorKey(7)]).toBeUndefined();
  });
});

describe('冷启动恢复', () => {
  it('填充内存中缺失的标签页', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: true };
    const store = await loadStore();

    await store.restoreHits();

    expect(store.getHitSummary(7)).toEqual({ ruleIds: ['old'], skippedRuleIds: {}, truncated: true });
    expect(store.listTabsWithAppliedHits()).toEqual([7]);
  });

  it('不覆盖重启后已记录的新命中', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    const store = await loadStore();

    holdGet();
    /** 尚未完成的恢复。 */
    const restoring = store.restoreHits();
    store.recordHits(7, [hit('fresh')]);
    releaseGet();
    await restoring;

    expect(store.getHitSummary(7).ruleIds).toEqual(['fresh']);
  });

  it('不让恢复期间已清空的标签页复活', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    const store = await loadStore();

    holdGet();
    /** 尚未完成的恢复。 */
    const restoring = store.restoreHits();
    // 顶层导航的重置发生在镜像读取返回之前：这正是冷启动被唤醒时的实际顺序。
    store.clearHits(7);
    releaseGet();
    await restoring;

    expect(store.getHitSummary(7).ruleIds).toEqual([]);
    expect(store.listTabsWithAppliedHits()).toEqual([]);
    await flushMirror();
    expect(session.data[mirrorKey(7)]).toBeUndefined();
  });

  it('不让恢复期间已关闭的标签页复活', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    const store = await loadStore();

    holdGet();
    /** 尚未完成的恢复。 */
    const restoring = store.restoreHits();
    store.dropTab(7);
    releaseGet();
    await restoring;

    expect(store.listTabsWithAppliedHits()).toEqual([]);
  });

  it('只跳过被改动过的标签页，其余照常恢复', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    session.data[mirrorKey(8)] = { hits: [hit('other')], truncated: false };
    const store = await loadStore();

    holdGet();
    /** 尚未完成的恢复。 */
    const restoring = store.restoreHits();
    store.clearHits(7);
    releaseGet();
    await restoring;

    expect(store.getHitSummary(7).ruleIds).toEqual([]);
    expect(store.getHitSummary(8).ruleIds).toEqual(['other']);
  });
});

describe('孤儿日志回收', () => {
  it('回收已不存在的标签页日志，并保留存活标签页的日志', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('gone')], truncated: false };
    session.data[mirrorKey(8)] = { hits: [hit('alive')], truncated: false };
    // 标签页 7 在 Service Worker 休眠期间关闭，且它的 onRemoved 没有被投递。
    tabs.live = [{ id: 8 }];
    const store = await loadStore();

    await store.restoreHits();

    expect(store.listTabsWithAppliedHits()).toEqual([8]);
    await flushMirror();
    expect(session.data[mirrorKey(7)]).toBeUndefined();
    expect(session.data[mirrorKey(8)]).toBeDefined();
  });

  it('标签查询失败时全量恢复，不误删日志', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    tabs.live = undefined;
    const store = await loadStore();

    await store.restoreHits();

    expect(store.getHitSummary(7).ruleIds).toEqual(['old']);
    await flushMirror();
    expect(session.data[mirrorKey(7)]).toBeDefined();
  });

  it('回收不影响恢复期间已被改动的标签页', async () => {
    session.data[mirrorKey(7)] = { hits: [hit('old')], truncated: false };
    tabs.live = [{ id: 7 }];
    const store = await loadStore();

    holdGet();
    /** 尚未完成的恢复。 */
    const restoring = store.restoreHits();
    store.recordHits(7, [hit('fresh')]);
    releaseGet();
    await restoring;

    expect(store.getHitSummary(7).ruleIds).toEqual(['fresh']);
  });
});

describe('标签页数量上限', () => {
  it('超出上限时淘汰最久未更新的标签页', async () => {
    const store = await loadStore();

    for (let tabId = 1; tabId <= MAX_TRACKED_TABS + 1; tabId += 1) {
      store.recordHits(tabId, [hit('r')]);
    }

    expect(store.listTabsWithAppliedHits()).toHaveLength(MAX_TRACKED_TABS);
    expect(store.getHitSummary(1).ruleIds).toEqual([]);
    expect(store.getHitSummary(MAX_TRACKED_TABS + 1).ruleIds).toEqual(['r']);
    await flushMirror();
    expect(session.data[mirrorKey(1)]).toBeUndefined();
    expect(session.data[mirrorKey(MAX_TRACKED_TABS + 1)]).toBeDefined();
  });

  it('再次记录会刷新活跃度，改由次久未更新的标签页被淘汰', async () => {
    const store = await loadStore();

    for (let tabId = 1; tabId <= MAX_TRACKED_TABS; tabId += 1) {
      store.recordHits(tabId, [hit('r')]);
    }
    // 标签页 1 重新活跃，此时最久未更新的是标签页 2。
    store.recordHits(1, [hit('again')]);
    store.recordHits(MAX_TRACKED_TABS + 1, [hit('newest')]);

    expect(store.getHitSummary(1).ruleIds).toEqual(['r', 'again']);
    expect(store.getHitSummary(2).ruleIds).toEqual([]);
  });

  it('恢复超额时按最后命中时间保留较活跃的标签页', async () => {
    // 刻意让镜像的读取顺序与活跃度相反：tabId 越小越活跃。若恢复后不按活跃度重排，
    // 淘汰会从读取顺序的队首开始，正好把最活跃的标签页丢掉。
    for (let tabId = 1; tabId <= MAX_TRACKED_TABS + 2; tabId += 1) {
      session.data[mirrorKey(tabId)] = {
        hits: [hit('r', MAX_TRACKED_TABS + 3 - tabId)],
        truncated: false,
      };
    }
    tabs.live = Array.from({ length: MAX_TRACKED_TABS + 2 }, (_, index) => ({ id: index + 1 }));
    const store = await loadStore();

    await store.restoreHits();

    expect(store.listTabsWithAppliedHits()).toHaveLength(MAX_TRACKED_TABS);
    expect(store.getHitSummary(1).ruleIds).toEqual(['r']);
    expect(store.getHitSummary(2).ruleIds).toEqual(['r']);
    expect(store.getHitSummary(MAX_TRACKED_TABS + 1).ruleIds).toEqual([]);
    expect(store.getHitSummary(MAX_TRACKED_TABS + 2).ruleIds).toEqual([]);
  });
});

describe('徽标判据', () => {
  it('只匹配上却未应用的记录不算有规则生效', async () => {
    const store = await loadStore();

    store.recordHits(7, [skippedHit('a')]);

    // 记录仍要留在日志里供 popup 解释原因，但徽标不该点亮
    expect(store.getHitSummary(7).skippedRuleIds).toEqual({ a: RuleHitSkipReason.SyncXhr });
    expect(store.hasAppliedHits(7)).toBe(false);
    expect(store.listTabsWithAppliedHits()).toEqual([]);
  });

  it('同一标签页出现已执行的命中后即算生效', async () => {
    const store = await loadStore();

    store.recordHits(7, [skippedHit('a')]);
    store.recordHits(7, [hit('b')]);

    expect(store.hasAppliedHits(7)).toBe(true);
    expect(store.listTabsWithAppliedHits()).toEqual([7]);
  });

  it('清空后不再算有规则生效', async () => {
    const store = await loadStore();

    store.recordHits(7, [hit('a')]);
    store.clearHits(7);

    expect(store.hasAppliedHits(7)).toBe(false);
  });

  it('冷启动恢复出的日志同样按已执行的命中判定', async () => {
    session.data[mirrorKey(7)] = { hits: [skippedHit('a')], truncated: false };
    session.data[mirrorKey(8)] = { hits: [hit('b')], truncated: false };
    const store = await loadStore();

    await store.restoreHits();

    expect(store.listTabsWithAppliedHits()).toEqual([8]);
  });
});
