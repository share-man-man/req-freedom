import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleHitSummary } from '@req-freedom/shared';
import { RuleActionType, STORAGE_KEY_RULE_HITS } from '@req-freedom/shared';

/** 由 mock 与用例共享的 storage.onChanged 假实现状态。 */
const storage = vi.hoisted(() => ({
  /** 已注册的变更监听器。 */
  listeners: [] as ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (
          listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void,
        ): void => {
          storage.listeners.push(listener);
        },
        removeListener: (
          listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void,
        ): void => {
          /** 待注销监听器在注册表中的位置。 */
          const index = storage.listeners.indexOf(listener);
          if (index >= 0) {
            storage.listeners.splice(index, 1);
          }
        },
      },
    },
  },
}));
import { watchTabHitSummary } from './storage';

/**
 * 模拟一次 storage 变更派发。
 * @param changes 变更内容
 * @param area 发生变更的存储区
 */
function emit(changes: Record<string, { newValue?: unknown }>, area = 'session'): void {
  for (const listener of [...storage.listeners]) {
    listener(changes, area);
  }
}

/**
 * 构造某个标签页的镜像变更。
 * @param tabId 标签页 ID
 * @param newValue 变更后的镜像值；省略表示镜像键被删除
 * @returns storage 变更内容
 */
function mirrorChange(tabId: number, newValue?: unknown): Record<string, { newValue?: unknown }> {
  return { [`${STORAGE_KEY_RULE_HITS}:${tabId}`]: { newValue } };
}

/** 一条可用于构造镜像日志的命中。 */
const HIT = { ruleId: 'a', action: RuleActionType.Block, url: 'https://x/api', method: 'GET', at: 1 };

beforeEach(() => {
  storage.listeners.length = 0;
});

describe('watchTabHitSummary', () => {
  /** 每次订阅收到的摘要。 */
  let received: RuleHitSummary[];

  beforeEach(() => {
    received = [];
  });

  it('镜像更新时投影成摘要', () => {
    watchTabHitSummary(7, (summary) => received.push(summary));

    emit(mirrorChange(7, { hits: [HIT, { ...HIT, ruleId: 'b' }], truncated: true }));

    expect(received).toEqual([{ ruleIds: ['a', 'b'], truncated: true }]);
  });

  it('镜像键被删除时给出空摘要', () => {
    // 命中日志被清空或标签页关闭时，background 删除镜像键而不是写入空日志。
    watchTabHitSummary(7, (summary) => received.push(summary));

    emit(mirrorChange(7));

    expect(received).toEqual([{ ruleIds: [], truncated: false }]);
  });

  it('忽略其他标签页与其他存储区的变更', () => {
    watchTabHitSummary(7, (summary) => received.push(summary));

    emit(mirrorChange(8, { hits: [HIT], truncated: false }));
    emit(mirrorChange(7, { hits: [HIT], truncated: false }), 'local');

    expect(received).toEqual([]);
  });

  it('取消订阅后不再回调', () => {
    /** 取消订阅的函数。 */
    const unwatch = watchTabHitSummary(7, (summary) => received.push(summary));

    unwatch();
    emit(mirrorChange(7, { hits: [HIT], truncated: false }));

    expect(received).toEqual([]);
  });
});
