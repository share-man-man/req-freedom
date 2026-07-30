import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rule } from '@req-freedom/shared';

/** 由 mock 与用例共享的 webRequest 假实现状态。 */
const webRequest = vi.hoisted(() => ({
  /** 通过 addListener 注册的监听器，按注册顺序保存。 */
  listeners: [] as ((details: { tabId: number; requestId: string }) => unknown)[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    webRequest: {
      onBeforeRequest: {
        addListener: (listener: (details: { tabId: number; requestId: string }) => unknown): void => {
          webRequest.listeners.push(listener);
        },
        removeListener: (): void => undefined,
      },
    },
  },
}));
import {
  HttpMethod,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
  RuleScopeType,
} from '@req-freedom/shared';
import { toRuleHits } from './dnr-observer';
import type { ActiveDnrRuleSnapshot } from './active-rules-cache';

/**
 * 构造一条 DNR 通道的测试规则。
 * @param id 规则 ID
 * @param actions 规则动作
 * @param overrides 需要覆盖的规则字段
 * @returns 字段完整的业务规则
 */
function rule(id: string, actions: unknown[], overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    name: id,
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType: MatchType.Contains,
    pattern: '/api',
    methods: [] as HttpMethod[],
    actions,
    ...overrides,
  } as Rule;
}

/**
 * 构造观测快照。
 * @param rules DNR 通道生效规则
 * @param tabIdsByRuleId 作用域规则解析出的目标 tabId
 * @returns 观测快照
 */
function snapshot(
  rules: Rule[],
  tabIdsByRuleId: Map<string, number[]> = new Map(),
): ActiveDnrRuleSnapshot {
  return { rules, tabIdsByRuleId };
}

/** 一条同时包含重定向与 Header 改写的规则。 */
const TWO_ACTION_RULE = rule('two', [
  { type: RuleActionType.Redirect, redirectUrl: 'https://y/api' },
  {
    type: RuleActionType.ModifyHeaders,
    headers: [{ target: 'request', operation: 'set', header: 'X-A', value: '1' }],
  },
]);

describe('toRuleHits', () => {
  it('一条规则的每个 DNR 动作各记一条命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api/users', method: 'GET', tabId: 7 },
      snapshot([TWO_ACTION_RULE]),
      99,
    );

    expect(hits).toEqual([
      { ruleId: 'two', action: RuleActionType.Redirect, url: 'https://x/api/users', method: 'GET', at: 99 },
      { ruleId: 'two', action: RuleActionType.ModifyHeaders, url: 'https://x/api/users', method: 'GET', at: 99 },
    ]);
  });

  it('空 Header 列表的改写动作不产生命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api', method: 'GET', tabId: 1 },
      snapshot([rule('empty', [{ type: RuleActionType.ModifyHeaders, headers: [] }])]),
      1,
    );

    expect(hits).toEqual([]);
  });

  it('页面补丁专属动作不计入 DNR 通道命中', () => {
    const hits = toRuleHits(
      { url: 'https://x/api', method: 'GET', tabId: 1 },
      snapshot([rule('page', [{ type: RuleActionType.Delay, preset: 'fast-3g' }])]),
      1,
    );

    expect(hits).toEqual([]);
  });

  it('方法不匹配时不产生命中', () => {
    /** 只对 POST 生效的拦截规则。 */
    const postOnly = rule('post-only', [{ type: RuleActionType.Block }], {
      methods: [HttpMethod.Post],
    });

    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 1 }, snapshot([postOnly]), 1))
      .toEqual([]);
    expect(toRuleHits({ url: 'https://x/api', method: 'POST', tabId: 1 }, snapshot([postOnly]), 1))
      .toHaveLength(1);
  });

  it('作用域规则只在解析出的标签页内命中', () => {
    /** 限定到 tab 42 的拦截规则。 */
    const scoped = rule('scoped', [{ type: RuleActionType.Block }], {
      scope: { type: RuleScopeType.Tab, targets: [{ id: 42, label: 'x' }] },
    });
    const scopedSnapshot = snapshot([scoped], new Map([['scoped', [42]]]));

    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 42 }, scopedSnapshot, 1))
      .toHaveLength(1);
    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: 9 }, scopedSnapshot, 1))
      .toEqual([]);
  });

  it('非标签页请求不记录命中', () => {
    expect(toRuleHits({ url: 'https://x/api', method: 'GET', tabId: -1 }, snapshot([TWO_ACTION_RULE]), 1))
      .toEqual([]);
  });
});

/** 顶层导航监听的测试夹具。 */
interface NavigationHarness {
  /** 被重置过的标签页，按发生顺序记录。 */
  resets: number[];
  /** 模拟一次 main_frame 请求。 */
  dispatch: (tabId: number, requestId: string) => void;
  /** 丢弃某个标签页的导航跟踪状态。 */
  forgetTab: (tabId: number) => void;
}

/**
 * 加载一份全新的观测模块并注册顶层导航监听。
 *
 * 模块以模块级 Map 跟踪各标签页最近一次导航，用例之间必须重置模块注册表才能互不影响。
 * @returns 顶层导航监听的测试夹具
 */
async function loadNavigationObserver(): Promise<NavigationHarness> {
  vi.resetModules();
  webRequest.listeners.length = 0;
  /** 全新加载的观测模块。 */
  const observer = await import('./dnr-observer');
  /** 被重置过的标签页。 */
  const resets: number[] = [];
  observer.observeTopLevelNavigation((tabId) => resets.push(tabId));
  /** 注册到 onBeforeRequest 的顶层导航监听。 */
  const listener = webRequest.listeners[0];
  return {
    resets,
    dispatch: (tabId, requestId) => void listener({ tabId, requestId }),
    forgetTab: observer.forgetTab,
  };
}

describe('observeTopLevelNavigation', () => {
  let harness: NavigationHarness;

  beforeEach(async () => {
    harness = await loadNavigationObserver();
  });

  it('新的顶层导航触发重置', () => {
    harness.dispatch(7, 'r1');

    expect(harness.resets).toEqual([7]);
  });

  it('同一次导航的重定向跳不再重置', () => {
    // 主文档被 DNR 重定向时，onBeforeRequest 会以同一个 requestId 对新地址再触发一次；
    // 若照常重置，这次导航自己的重定向命中会被抹掉。
    harness.dispatch(7, 'r1');
    harness.dispatch(7, 'r1');
    harness.dispatch(7, 'r1');

    expect(harness.resets).toEqual([7]);
  });

  it('重定向之后的下一次导航仍会重置', () => {
    harness.dispatch(7, 'r1');
    harness.dispatch(7, 'r1');
    harness.dispatch(7, 'r2');

    expect(harness.resets).toEqual([7, 7]);
  });

  it('各标签页独立跟踪各自的导航', () => {
    harness.dispatch(7, 'r1');
    harness.dispatch(8, 'r2');
    harness.dispatch(7, 'r1');
    harness.dispatch(8, 'r2');

    expect(harness.resets).toEqual([7, 8]);
  });

  it('非标签页请求不触发重置', () => {
    harness.dispatch(-1, 'r1');

    expect(harness.resets).toEqual([]);
  });

  it('标签页关闭后不再保留其导航跟踪状态', () => {
    harness.dispatch(7, 'r1');
    harness.forgetTab(7);
    // requestId 在会话内唯一，实际不会重现；这里仅用于观察跟踪状态确已清除。
    harness.dispatch(7, 'r1');

    expect(harness.resets).toEqual([7, 7]);
  });
});
