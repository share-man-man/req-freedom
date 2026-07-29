import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleHit } from '@req-freedom/shared';
import { RuleActionType, STORAGE_KEY_RULE_HITS } from '@req-freedom/shared';

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

vi.mock('wxt/browser', () => ({
  browser: {
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
 * @returns 字段完整的命中记录
 */
function hit(ruleId: string): RuleHit {
  return { ruleId, action: RuleActionType.Block, url: 'https://x/api', method: 'GET', at: 1 };
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('命中存储的镜像同步', () => {
  it('命中经防抖写回镜像', async () => {
    const store = await loadStore();

    expect(store.recordHits(7, [hit('a')])).toBe(true);
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

    expect(store.getHitSummary(7)).toEqual({ ruleIds: ['old'], truncated: true });
    expect(store.listTabsWithHits()).toEqual([7]);
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
    expect(store.listTabsWithHits()).toEqual([]);
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

    expect(store.listTabsWithHits()).toEqual([]);
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
