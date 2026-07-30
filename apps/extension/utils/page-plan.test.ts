import { describe, expect, it } from 'vitest';
import type { Rule } from '@req-freedom/shared';
import {
  BodyMatchType,
  HttpMethod,
  MatchType,
  MockResponseMode,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleHitOutcome,
  RuleHitSkipReason,
} from '@req-freedom/shared';
import { resolvePagePlan, resolveSyncXhrSkippedHits, toSkippedHit } from './page-plan';

/**
 * 构造一条页面补丁通道的测试规则。
 * @param id 规则 ID
 * @param actions 规则动作
 * @returns 字段完整的业务规则
 */
function rule(id: string, actions: Rule['actions']): Rule {
  return {
    id,
    name: id,
    enabled: true,
    channel: RuleExecutionChannel.PagePatch,
    matchType: MatchType.Contains,
    pattern: '/api',
    methods: [] as HttpMethod[],
    actions,
  } as Rule;
}

/** 短路 Mock（不发真实请求）。 */
const SHORT_CIRCUIT_MOCK = rule('mock', [
  { type: RuleActionType.MockResponse, mode: MockResponseMode.Static, statusCode: 200, statusText: 'OK', body: '{}' },
] as Rule['actions']);

/** 基于真实响应的 Mock（仍会发真实请求）。 */
const PASSTHROUGH_MOCK = rule('passthrough', [
  {
    type: RuleActionType.MockResponse,
    mode: MockResponseMode.Dynamic,
    passthrough: true,
    statusCode: 200,
    statusText: 'OK',
    body: '',
    functionCode: 'function mock(req, res) { return res.json; }',
  },
] as Rule['actions']);

/** 改请求体规则。 */
const MODIFY_BODY = rule('modify-body', [
  {
    type: RuleActionType.ModifyRequestBody,
    mode: RequestBodyMode.Replace,
    sourceMode: RequestBodySourceMode.Static,
    content: '{"a":1}',
  },
] as Rule['actions']);

/** 网络限速规则。 */
const DELAY = rule('delay', [
  { type: RuleActionType.Delay, preset: 'fast-3g' },
] as unknown as Rule['actions']);

describe('resolvePagePlan', () => {
  it('基于真实响应的 Mock 下改请求体仍会执行并记一条命中', () => {
    const plan = resolvePagePlan([PASSTHROUGH_MOCK, MODIFY_BODY], 'https://x/api', 'POST', 1);

    expect(plan.modifyBody).toBeDefined();
    expect(plan.hits.map((hit) => hit.ruleId)).toEqual(['modify-body']);
    expect(plan.mockHit?.ruleId).toBe('passthrough');
  });

  it('短路 Mock 下改请求体不执行也不记命中', () => {
    const plan = resolvePagePlan([SHORT_CIRCUIT_MOCK, MODIFY_BODY], 'https://x/api', 'POST', 1);

    expect(plan.modifyBody).toBeUndefined();
    expect(plan.hits).toEqual([]);
    expect(plan.mockHit?.ruleId).toBe('mock');
  });

  it('GET / HEAD 不执行改请求体', () => {
    for (const method of ['GET', 'HEAD']) {
      const plan = resolvePagePlan([MODIFY_BODY], 'https://x/api', method, 1);

      expect(plan.modifyBody).toBeUndefined();
      expect(plan.hits).toEqual([]);
    }
  });

  it('Mock 短路时限速仍然计入', () => {
    const plan = resolvePagePlan([SHORT_CIRCUIT_MOCK, DELAY], 'https://x/api', 'GET', 1);

    expect(plan.delay).toBeDefined();
    expect(plan.hits.map((hit) => hit.ruleId)).toEqual(['delay']);
    expect(plan.mockHit?.ruleId).toBe('mock');
  });

  it('命中记录带上请求上下文与动作类型', () => {
    const plan = resolvePagePlan([DELAY], 'https://x/api?q=1', 'PUT', 42);

    expect(plan.hits).toEqual([
      {
        ruleId: 'delay',
        action: RuleActionType.Delay,
        url: 'https://x/api?q=1',
        method: 'PUT',
        at: 42,
        outcome: RuleHitOutcome.Applied,
      },
    ]);
  });

  it('Mock 的命中与计划分开返回，等执行处确认结果后再上报', () => {
    // 「基于真实响应」的 Mock 遇到不透明响应时读不到 body，只能原样放行；
    // 若随计划一起上报，就会宣称一次并未发生的改写。
    const plan = resolvePagePlan([PASSTHROUGH_MOCK], 'https://x/api', 'GET', 1);

    expect(plan.hits).toEqual([]);
    expect(plan.mockHit?.outcome).toBe(RuleHitOutcome.Applied);
  });

  it('无命中规则时计划为空', () => {
    expect(resolvePagePlan([], 'https://x/api', 'POST', 1)).toEqual({
      mock: undefined,
      delay: undefined,
      modifyBody: undefined,
      hits: [],
      mockHit: undefined,
    });
  });
});

describe('resolveSyncXhrSkippedHits', () => {
  it('命中的动作全部记为 SyncXhr 跳过', () => {
    const hits = resolveSyncXhrSkippedHits(
      [SHORT_CIRCUIT_MOCK, DELAY],
      'https://x/api',
      'GET',
      3,
    );

    expect(hits).toEqual([
      {
        ruleId: 'delay',
        action: RuleActionType.Delay,
        url: 'https://x/api',
        method: 'GET',
        at: 3,
        outcome: RuleHitOutcome.Skipped,
        reason: RuleHitSkipReason.SyncXhr,
      },
      {
        ruleId: 'mock',
        action: RuleActionType.MockResponse,
        url: 'https://x/api',
        method: 'GET',
        at: 3,
        outcome: RuleHitOutcome.Skipped,
        reason: RuleHitSkipReason.SyncXhr,
      },
    ]);
  });

  it('带请求体条件的规则不上报——同步路径读不到请求体，无从确认是否真的匹配', () => {
    /** 只在请求体命中时才生效的 Mock 规则。 */
    const bodyMatched: Rule = {
      ...SHORT_CIRCUIT_MOCK,
      id: 'body-matched',
      bodyMatch: { type: BodyMatchType.Contains, value: 'x' },
    };

    expect(resolveSyncXhrSkippedHits([bodyMatched], 'https://x/api', 'POST', 1)).toEqual([]);
    // 同一批里不带请求体条件的规则照常上报
    expect(
      resolveSyncXhrSkippedHits([bodyMatched, DELAY], 'https://x/api', 'POST', 1).map(
        (hit) => hit.ruleId,
      ),
    ).toEqual(['delay']);
  });

  it('无命中规则时不产生记录', () => {
    expect(resolveSyncXhrSkippedHits([], 'https://x/api', 'GET', 1)).toEqual([]);
  });

  it('沿用执行计划的取舍：GET 下不上报改请求体', () => {
    // 同步 XHR 即便放行，GET 也不会带请求体，报一条「未应用的改请求体」只会误导
    expect(resolveSyncXhrSkippedHits([MODIFY_BODY], 'https://x/api', 'GET', 1)).toEqual([]);
    expect(
      resolveSyncXhrSkippedHits([MODIFY_BODY], 'https://x/api', 'POST', 1).map((hit) => hit.ruleId),
    ).toEqual(['modify-body']);
  });
});

describe('toSkippedHit', () => {
  it('保留原记录并改写为带原因的跳过', () => {
    const plan = resolvePagePlan([DELAY], 'https://x/api', 'GET', 7);
    const [hit] = plan.hits;

    expect(toSkippedHit(hit!, RuleHitSkipReason.SyncXhr)).toEqual({
      ...hit,
      outcome: RuleHitOutcome.Skipped,
      reason: RuleHitSkipReason.SyncXhr,
    });
  });
});
