import { describe, expect, it } from 'vitest';
import type { Rule } from '@req-freedom/shared';
import {
  HttpMethod,
  MatchType,
  MockResponseMode,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import { resolvePagePlan } from './page-plan';

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
    expect(plan.hits.map((hit) => hit.ruleId).sort()).toEqual(['modify-body', 'passthrough']);
  });

  it('短路 Mock 下改请求体不执行也不记命中', () => {
    const plan = resolvePagePlan([SHORT_CIRCUIT_MOCK, MODIFY_BODY], 'https://x/api', 'POST', 1);

    expect(plan.modifyBody).toBeUndefined();
    expect(plan.hits.map((hit) => hit.ruleId)).toEqual(['mock']);
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
    expect(plan.hits.map((hit) => hit.ruleId)).toEqual(['mock', 'delay']);
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
      },
    ]);
  });

  it('无命中规则时计划为空', () => {
    expect(resolvePagePlan([], 'https://x/api', 'POST', 1)).toEqual({
      mock: undefined,
      delay: undefined,
      modifyBody: undefined,
      hits: [],
    });
  });
});
