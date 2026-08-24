import type {
  MockResponseAction,
  Rule,
  SseDebugSendNextCommand,
  SseDebugSession,
  SseEvent,
} from '@req-freedom/shared';
import {
  MockResponseDelivery,
  RuleActionType,
  SseDebugSendKind,
  SseDebugSessionStatus,
  SseEndBehavior,
  SseSendMode,
} from '@req-freedom/shared';

/**
 * 读取规则中启用手动单步发送的 SSE Mock 动作。
 * @param rule 待检查的业务规则
 * @returns 手动 SSE Mock 动作；不适用时返回 undefined
 */
export function getManualSseMockAction(rule: Rule): MockResponseAction | undefined {
  return rule.actions.find(
    (action): action is MockResponseAction =>
      action.type === RuleActionType.MockResponse &&
      action.delivery === MockResponseDelivery.Sse &&
      action.sseSendMode === SseSendMode.Manual,
  );
}

/**
 * 判断 SSE 会话是否仍由页面持有、可以等待或执行下一次控制命令。
 * @param session 待判断的会话
 * @returns 会话是否仍活动
 */
function isActiveSseDebugSession(session: SseDebugSession): boolean {
  return session.status === SseDebugSessionStatus.Connected ||
    session.status === SseDebugSessionStatus.KeptOpen;
}

/**
 * 列出当前标签页中一条规则可展示的 SSE 调试连接。
 *
 * 展示顺序使用最新连接优先，便于快速找到刚发起的请求；已断开连接不再展示，
 * 正常完成的连接保留最终进度。
 * @param sessions 当前页面 bridge 返回的会话快照
 * @param ruleId 目标规则 ID
 * @returns 最新连接优先的可展示连接
 */
export function listVisibleSseDebugSessions(
  sessions: readonly SseDebugSession[],
  ruleId: string,
): SseDebugSession[] {
  return sessions
    .filter((session) => session.ruleId === ruleId)
    .filter((session) =>
      isActiveSseDebugSession(session) ||
      session.status === SseDebugSessionStatus.Completed,
    )
    .sort((left, right) =>
      right.connectedAt - left.connectedAt || right.id.localeCompare(left.id),
    );
}

/**
 * 根据已保存规则与运行时游标构造一次“发送下一条”命令。
 * @param action 当前规则中已保存的手动 SSE Mock 动作
 * @param session popup 选中的活动会话
 * @param eventOverride popup 输入框中可选的临时事件快照
 * @returns 可发送命令；正在发送、连接已关闭或配置不合法时返回 undefined
 */
export function createSseSendNextCommand(
  action: MockResponseAction,
  session: SseDebugSession,
  eventOverride?: SseEvent,
): SseDebugSendNextCommand | undefined {
  if (
    session.status !== SseDebugSessionStatus.Connected &&
    session.status !== SseDebugSessionStatus.KeptOpen
  ) {
    return undefined;
  }
  /** 当前已保存的 SSE 事件列表。 */
  const events = action.sseEvents ?? [];
  /** 运行时游标指向的下一条已保存事件。 */
  const event = events[session.nextEventIndex];
  /** 当前已保存的结束行为。 */
  const endBehavior = action.sseEndBehavior ?? SseEndBehavior.Close;
  if (session.status === SseDebugSessionStatus.KeptOpen) {
    return {
      sessionId: session.id,
      kind: SseDebugSendKind.Custom,
      eventIndex: session.nextEventIndex,
      event: eventOverride ?? { data: '' },
      eventCount: session.eventCount,
      endBehavior: SseEndBehavior.KeepOpen,
    };
  }
  if (!event || endBehavior === SseEndBehavior.Loop) {
    return undefined;
  }
  return {
    sessionId: session.id,
    kind: SseDebugSendKind.Preset,
    eventIndex: session.nextEventIndex,
    event: eventOverride ?? event,
    eventCount: events.length,
    endBehavior,
  };
}
