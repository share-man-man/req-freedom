import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleHitSummary } from '@req-freedom/shared';
import {
  RuleActionType,
  RuleHitOutcome,
  STORAGE_KEY_PENDING_RULE_HIGHLIGHT,
  STORAGE_KEY_RULE_HITS,
} from '@req-freedom/shared';

/** 由 mock 与用例共享的 storage.onChanged 假实现状态。 */
const storage = vi.hoisted(() => ({
  /** 已注册的变更监听器。 */
  listeners: [] as ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[],
  /** 被移除的 session storage 键。 */
  removedKeys: [] as string[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      session: {
        remove: async (key: string): Promise<void> => {
          storage.removedKeys.push(key);
        },
      },
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
import { watchPendingRuleHighlight, watchTabHitSummary } from './storage';

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
const HIT = {
  ruleId: 'a',
  action: RuleActionType.Block,
  url: 'https://x/api',
  method: 'GET',
  at: 1,
  outcome: RuleHitOutcome.Applied,
};

beforeEach(() => {
  storage.listeners.length = 0;
  storage.removedKeys.length = 0;
});

describe('watchPendingRuleHighlight', () => {
  it('收到合法请求后定位并消费一次性状态', () => {
    /** 收到的规则 ID。 */
    const received: string[] = [];
    watchPendingRuleHighlight((ruleId) => received.push(ruleId));

    emit({
      [STORAGE_KEY_PENDING_RULE_HIGHLIGHT]: {
        newValue: { ruleId: 'rule-a', requestId: 'request-a' },
      },
    });

    expect(received).toEqual(['rule-a']);
    expect(storage.removedKeys).toEqual([STORAGE_KEY_PENDING_RULE_HIGHLIGHT]);
  });

  it('忽略删除事件、格式错误的请求与其他存储区', () => {
    /** 收到的规则 ID。 */
    const received: string[] = [];
    watchPendingRuleHighlight((ruleId) => received.push(ruleId));

    emit({ [STORAGE_KEY_PENDING_RULE_HIGHLIGHT]: {} });
    emit({
      [STORAGE_KEY_PENDING_RULE_HIGHLIGHT]: { newValue: { ruleId: 'rule-a' } },
    });
    emit(
      {
        [STORAGE_KEY_PENDING_RULE_HIGHLIGHT]: {
          newValue: { ruleId: 'rule-a', requestId: 'request-a' },
        },
      },
      'local',
    );

    expect(received).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });
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

    expect(received).toEqual([{ ruleIds: ['a', 'b'], skippedRuleIds: {}, truncated: true }]);
  });

  it('镜像键被删除时给出空摘要', () => {
    // 命中日志被清空或标签页关闭时，background 删除镜像键而不是写入空日志。
    watchTabHitSummary(7, (summary) => received.push(summary));

    emit(mirrorChange(7));

    expect(received).toEqual([{ ruleIds: [], skippedRuleIds: {}, truncated: false }]);
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
