import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rule } from '@req-freedom/shared';

/** 被观测请求的完整字段，覆盖两个监听器各自需要的部分。 */
interface ObservedDetails {
  /** 完整请求 URL。 */
  url: string;
  /** 请求方法。 */
  method: string;
  /** 发起请求的标签页。 */
  tabId: number;
  /** 请求 ID；同一次导航的重定向跳保持不变。 */
  requestId: string;
  /** 资源类型。 */
  type: string;
}

/** 由 mock 与用例共享的 webRequest 假实现状态。 */
const webRequest = vi.hoisted(() => ({
  /** 通过 addListener 注册的监听器与其过滤条件，按注册顺序保存。 */
  listeners: [] as {
    /** 监听器本体。 */
    listener: (details: never) => unknown;
    /** 注册时声明的过滤条件；省略 types 表示接受全部资源类型。 */
    filter: { urls: string[]; types?: string[] };
  }[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    webRequest: {
      onBeforeRequest: {
        addListener: (
          listener: (details: never) => unknown,
          filter: { urls: string[]; types?: string[] },
        ): void => {
          webRequest.listeners.push({ listener, filter });
        },
        removeListener: (listener: (details: never) => unknown): void => {
          /** 待注销监听器在注册表中的位置。 */
          const index = webRequest.listeners.findIndex((entry) => entry.listener === listener);
          if (index >= 0) {
            webRequest.listeners.splice(index, 1);
          }
        },
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


/** 一条只拦截的规则，用于让被观测请求产生恰好一条命中。 */
const BLOCK_RULE = rule('block', [{ type: RuleActionType.Block }]);

/** 请求观测的测试夹具。 */
interface ObserverHarness {
  /** 回调发生顺序；重置与记录混在同一序列，便于断言先后。 */
  events: string[];
  /** 把一个请求派发给当前已注册的全部监听器。 */
  dispatch: (details: ObservedDetails, options?: { reverse?: boolean }) => void;
  /** 丢弃某个标签页的导航跟踪状态。 */
  forgetTab: (tabId: number) => void;
  /** 注册或注销子资源监听。 */
  syncSubResourceListener: (hasActiveRules: boolean) => void;
}

/**
 * 构造一次顶层文档请求。
 * @param tabId 标签页 ID
 * @param requestId 请求 ID
 * @param url 请求 URL
 * @returns 顶层文档请求详情
 */
function mainFrame(tabId: number, requestId: string, url = 'https://x/api'): ObservedDetails {
  return { url, method: 'GET', tabId, requestId, type: 'main_frame' };
}

/**
 * 构造一次子资源请求。
 * @param tabId 标签页 ID
 * @param requestId 请求 ID
 * @returns 子资源请求详情
 */
function subResource(tabId: number, requestId: string): ObservedDetails {
  return { url: 'https://x/api', method: 'GET', tabId, requestId, type: 'xmlhttprequest' };
}

/**
 * 加载一份全新的观测模块并注册两个监听器。
 *
 * 模块以模块级 Map 跟踪各标签页最近一次导航，用例之间必须重置模块注册表才能互不影响。
 * @returns 请求观测的测试夹具
 */
async function loadObserver(): Promise<ObserverHarness> {
  vi.resetModules();
  webRequest.listeners.length = 0;
  /** 全新加载的观测模块。 */
  const observer = await import('./dnr-observer');
  /** 与观测模块同一份模块图中的规则快照缓存。 */
  const cache = await import('./active-rules-cache');
  cache.setActiveDnrRules(snapshot([BLOCK_RULE]));
  /** 回调发生顺序。 */
  const events: string[] = [];
  observer.initRuleHitObserver({
    onNavigationReset: (tabId) => events.push(`reset:${tabId}`),
    onRuleHits: (tabId) => events.push(`hits:${tabId}`),
  });
  observer.syncSubResourceListener(true);
  return {
    events,
    dispatch: (details, options) => {
      /** 过滤条件接受本次资源类型的监听器。 */
      const matched = webRequest.listeners.filter(
        (entry) => !entry.filter.types || entry.filter.types.includes(details.type),
      );
      /** 本次派发顺序；reverse 用于模拟未承诺的监听器派发顺序。 */
      const listeners = options?.reverse ? matched.reverse() : matched;
      for (const { listener } of listeners) {
        listener(details as never);
      }
    },
    forgetTab: observer.forgetTab,
    syncSubResourceListener: observer.syncSubResourceListener,
  };
}

describe('请求观测', () => {
  let harness: ObserverHarness;

  beforeEach(async () => {
    harness = await loadObserver();
  });

  it('新的顶层导航先重置、再记录本次请求自身的命中', () => {
    harness.dispatch(mainFrame(7, 'r1'));

    expect(harness.events).toEqual(['reset:7', 'hits:7']);
  });

  it('主文档的重置与记录不依赖两个监听器的派发顺序', () => {
    // webRequest 未承诺同一扩展内多个观测监听器的先后，因此主文档由常驻监听独占处理：
    // 反序派发时结果必须完全一致，否则命中主文档的规则会被紧随其后的重置抹掉。
    harness.dispatch(mainFrame(7, 'r1'), { reverse: true });

    expect(harness.events).toEqual(['reset:7', 'hits:7']);
  });

  it('同一次导航的重定向跳不再重置，但仍记录命中', () => {
    harness.dispatch(mainFrame(7, 'r1'));
    harness.dispatch(mainFrame(7, 'r1', 'https://x/api/next'));

    expect(harness.events).toEqual(['reset:7', 'hits:7', 'hits:7']);
  });

  it('重定向之后的下一次导航仍会重置', () => {
    harness.dispatch(mainFrame(7, 'r1'));
    harness.dispatch(mainFrame(7, 'r1'));
    harness.dispatch(mainFrame(7, 'r2'));

    expect(harness.events.filter((event) => event.startsWith('reset'))).toEqual(['reset:7', 'reset:7']);
  });

  it('各标签页独立跟踪各自的导航', () => {
    harness.dispatch(mainFrame(7, 'r1'));
    harness.dispatch(mainFrame(8, 'r2'));
    harness.dispatch(mainFrame(7, 'r1'));
    harness.dispatch(mainFrame(8, 'r2'));

    expect(harness.events.filter((event) => event.startsWith('reset'))).toEqual(['reset:7', 'reset:8']);
  });

  it('非标签页请求既不重置也不记录', () => {
    harness.dispatch(mainFrame(-1, 'r1'));

    expect(harness.events).toEqual([]);
  });

  it('标签页关闭后不再保留其导航跟踪状态', () => {
    harness.dispatch(mainFrame(7, 'r1'));
    harness.forgetTab(7);
    // requestId 在会话内唯一，实际不会重现；这里仅用于观察跟踪状态确已清除。
    harness.dispatch(mainFrame(7, 'r1'));

    expect(harness.events.filter((event) => event.startsWith('reset'))).toEqual(['reset:7', 'reset:7']);
  });

  it('子资源请求只记录命中，不触发重置', () => {
    harness.dispatch(subResource(7, 'r1'));

    expect(harness.events).toEqual(['hits:7']);
  });

  it('注销子资源监听后不再记录子资源命中', () => {
    harness.syncSubResourceListener(false);
    harness.dispatch(subResource(7, 'r1'));

    expect(harness.events).toEqual([]);
  });

  it('注销子资源监听后顶层导航仍照常重置与记录', () => {
    harness.syncSubResourceListener(false);
    harness.dispatch(mainFrame(7, 'r1'));

    expect(harness.events).toEqual(['reset:7', 'hits:7']);
  });
});
