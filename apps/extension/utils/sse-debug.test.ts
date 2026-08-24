import { describe, expect, it } from 'vitest';
import type { MockResponseAction, Rule, SseDebugSession } from '@req-freedom/shared';
import {
  HttpMethod,
  MatchType,
  MockResponseDelivery,
  MockResponseMode,
  RuleActionType,
  RuleExecutionChannel,
  SseDebugClient,
  SseDebugSendKind,
  SseDebugSessionStatus,
  SseEndBehavior,
  SseSendMode,
  parseSseDebugCommandResult,
  parseSseDebugSendNextCommand,
  parseSseDebugSession,
  parseSseEvent,
} from '@req-freedom/shared';
import {
  createSseSendNextCommand,
  getManualSseMockAction,
  listVisibleSseDebugSessions,
} from './sse-debug';

/** 测试使用的手动 SSE Mock 动作。 */
const MANUAL_ACTION: MockResponseAction = {
  type: RuleActionType.MockResponse,
  mode: MockResponseMode.Static,
  delivery: MockResponseDelivery.Sse,
  statusCode: 200,
  body: '',
  sseSendMode: SseSendMode.Manual,
  sseEndBehavior: SseEndBehavior.Close,
  sseEvents: [{ data: 'first' }, { event: 'done', data: 'second' }],
};

/**
 * 构造测试会话。
 * @param overrides 要覆盖的会话字段
 * @returns 完整 SSE 调试会话
 */
function session(overrides: Partial<SseDebugSession> = {}): SseDebugSession {
  return {
    id: 'session',
    ruleId: 'rule',
    url: 'https://example.com/events',
    client: SseDebugClient.Fetch,
    nextEventIndex: 0,
    eventCount: 2,
    status: SseDebugSessionStatus.Connected,
    connectedAt: 100,
    ...overrides,
  };
}

describe('popup SSE manual debug helpers', () => {
  it('共享解析器保留 SSE 协议中空 ID 与缺省延迟的区别', () => {
    expect(parseSseEvent({ data: 'reset', id: '' })).toEqual({ data: 'reset', id: '' });
    expect(parseSseEvent({ data: 'invalid', retryMs: -1 })).toBeUndefined();
  });

  it('共享解析器统一校验跨上下文会话、命令与结果', () => {
    /** 经过共享解析器校验的测试会话。 */
    const parsedSession = parseSseDebugSession(session());
    /** 经过共享解析器校验的测试命令。 */
    const parsedCommand = parseSseDebugSendNextCommand({
      sessionId: 'session',
      kind: SseDebugSendKind.Preset,
      eventIndex: 0,
      event: { data: 'first' },
      eventCount: 2,
      endBehavior: SseEndBehavior.Close,
    });

    expect(parsedSession).toEqual(session());
    expect(parsedCommand?.event.data).toBe('first');
    expect(parseSseDebugCommandResult({ ok: true, session: parsedSession })).toEqual({
      ok: true,
      session: parsedSession,
    });
    expect(parseSseDebugSendNextCommand({
      ...parsedCommand,
      kind: 'unknown',
    })).toBeUndefined();
  });

  it('只识别手动 SSE Mock 动作', () => {
    /** 包含手动 SSE 动作的测试规则。 */
    const rule: Rule = {
      id: 'rule',
      name: 'SSE',
      enabled: true,
      channel: RuleExecutionChannel.PagePatch,
      methods: [HttpMethod.Get],
      matchType: MatchType.Contains,
      pattern: '/events',
      actions: [MANUAL_ACTION],
    };

    expect(getManualSseMockAction(rule)).toBe(MANUAL_ACTION);
    expect(getManualSseMockAction({
      ...rule,
      actions: [{ ...MANUAL_ACTION, sseSendMode: SseSendMode.Auto }],
    })).toBeUndefined();
  });

  it('只列出当前规则的可见连接并按最新优先展示', () => {
    /** 混合不同规则与状态的会话。 */
    const sessions = [
      session({ id: 'older', connectedAt: 100 }),
      session({ id: 'other-rule', ruleId: 'other', connectedAt: 400 }),
      session({ id: 'closed', status: SseDebugSessionStatus.Closed, connectedAt: 300 }),
      session({ id: 'newer', connectedAt: 200 }),
      session({ id: 'completed', status: SseDebugSessionStatus.Completed, connectedAt: 250 }),
    ];

    expect(listVisibleSseDebugSessions(sessions, 'rule').map(({ id }) => id)).toEqual([
      'completed',
      'newer',
      'older',
    ]);
  });

  it('按运行时游标读取已保存事件并构造单步命令', () => {
    expect(createSseSendNextCommand(
      MANUAL_ACTION,
      session({ nextEventIndex: 1 }),
    )).toEqual({
      sessionId: 'session',
      kind: SseDebugSendKind.Preset,
      eventIndex: 1,
      event: { event: 'done', data: 'second' },
      eventCount: 2,
      endBehavior: SseEndBehavior.Close,
    });
    expect(createSseSendNextCommand(
      MANUAL_ACTION,
      session({ nextEventIndex: 1 }),
      { event: 'custom', id: 'edited-id', retryMs: 500, data: 'edited data' },
    )?.event).toEqual({
      event: 'custom',
      id: 'edited-id',
      retryMs: 500,
      data: 'edited data',
    });
    expect(createSseSendNextCommand(
      MANUAL_ACTION,
      session({ status: SseDebugSessionStatus.Completed }),
    )).toBeUndefined();
    expect(createSseSendNextCommand(
      MANUAL_ACTION,
      session({ nextEventIndex: 2 }),
    )).toBeUndefined();
  });

  it('预设事件发完且保持连接时构造可重复发送的自定义事件命令', () => {
    expect(createSseSendNextCommand(
      { ...MANUAL_ACTION, sseEndBehavior: SseEndBehavior.KeepOpen },
      session({
        nextEventIndex: 2,
        status: SseDebugSessionStatus.KeptOpen,
      }),
    )).toEqual({
      sessionId: 'session',
      kind: SseDebugSendKind.Custom,
      eventIndex: 2,
      event: { data: '' },
      eventCount: 2,
      endBehavior: SseEndBehavior.KeepOpen,
    });
    expect(createSseSendNextCommand(
      { ...MANUAL_ACTION, sseEndBehavior: SseEndBehavior.KeepOpen },
      session({
        nextEventIndex: 2,
        status: SseDebugSessionStatus.KeptOpen,
      }),
      { event: 'extra', id: 'custom-id', retryMs: 800, data: 'custom data' },
    )?.event).toEqual({
      event: 'extra',
      id: 'custom-id',
      retryMs: 800,
      data: 'custom data',
    });
    expect(createSseSendNextCommand(
      { ...MANUAL_ACTION, sseEndBehavior: SseEndBehavior.KeepOpen },
      session({
        nextEventIndex: 2,
        status: SseDebugSessionStatus.Completed,
      }),
    )).toBeUndefined();
  });
});
