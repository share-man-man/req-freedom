import {
  SseDebugClient,
  SseDebugCommandFailureReason,
  SseDebugSendKind,
  SseDebugSessionStatus,
  SseEndBehavior,
} from './enums';
import type {
  SseDebugCommandResult,
  SseDebugSession,
  SseDebugSendNextCommand,
  SseEvent,
} from './types';

/** 可接受的手动 SSE 客户端类型。 */
const SSE_DEBUG_CLIENTS = new Set<string>(Object.values(SseDebugClient));
/** 可接受的手动 SSE 会话状态。 */
const SSE_DEBUG_SESSION_STATUSES = new Set<string>(Object.values(SseDebugSessionStatus));
/** 可接受的手动 SSE 命令失败原因。 */
const SSE_DEBUG_COMMAND_FAILURE_REASONS = new Set<string>(
  Object.values(SseDebugCommandFailureReason),
);

/**
 * 判断未知值是否为普通对象。
 * @param value 待判断值
 * @returns 是否可安全按键读取
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把跨持久化或跨上下文收到的未知值净化为 SSE 事件。
 * @param value 未知事件值
 * @returns 合法事件副本；字段不合法时返回 undefined
 */
export function parseSseEvent(value: unknown): SseEvent | undefined {
  if (!isRecord(value) || typeof value.data !== 'string') {
    return undefined;
  }
  if (value.event !== undefined && typeof value.event !== 'string') {
    return undefined;
  }
  if (value.id !== undefined && typeof value.id !== 'string') {
    return undefined;
  }
  for (const field of ['retryMs', 'delayMs'] as const) {
    /** 当前可选数字字段的未知值。 */
    const fieldValue = value[field];
    if (
      fieldValue !== undefined &&
      (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0)
    ) {
      return undefined;
    }
  }
  return {
    data: value.data,
    ...(value.event !== undefined ? { event: value.event } : {}),
    ...(value.id !== undefined ? { id: value.id } : {}),
    ...(value.retryMs !== undefined ? { retryMs: value.retryMs as number } : {}),
    ...(value.delayMs !== undefined ? { delayMs: value.delayMs as number } : {}),
  };
}

/**
 * 校验 MAIN world 或 bridge 提供的手动 SSE 会话。
 * @param value 未知会话值
 * @returns 净化后的会话；字段不合法时返回 undefined
 */
export function parseSseDebugSession(value: unknown): SseDebugSession | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.id !== 'string' ||
    value.id === '' ||
    typeof value.ruleId !== 'string' ||
    value.ruleId === '' ||
    typeof value.url !== 'string' ||
    !SSE_DEBUG_CLIENTS.has(String(value.client)) ||
    !Number.isInteger(value.nextEventIndex) ||
    (value.nextEventIndex as number) < 0 ||
    !Number.isInteger(value.eventCount) ||
    (value.eventCount as number) < 0 ||
    !SSE_DEBUG_SESSION_STATUSES.has(String(value.status)) ||
    typeof value.connectedAt !== 'number' ||
    !Number.isFinite(value.connectedAt) ||
    value.connectedAt < 0
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ruleId: value.ruleId,
    url: value.url,
    client: value.client as SseDebugClient,
    nextEventIndex: value.nextEventIndex as number,
    eventCount: value.eventCount as number,
    status: value.status as SseDebugSessionStatus,
    connectedAt: value.connectedAt,
  };
}

/**
 * 校验 popup 发给 MAIN world 的单步发送命令。
 * @param value 未知命令值
 * @returns 净化后的命令；字段不合法时返回 undefined
 */
export function parseSseDebugSendNextCommand(
  value: unknown,
): SseDebugSendNextCommand | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  /** 命令携带的 SSE 事件。 */
  const event = parseSseEvent(value.event);
  if (
    typeof value.sessionId !== 'string' ||
    value.sessionId === '' ||
    !Object.values(SseDebugSendKind).includes(value.kind as SseDebugSendKind) ||
    !Number.isInteger(value.eventIndex) ||
    (value.eventIndex as number) < 0 ||
    !event ||
    !Number.isInteger(value.eventCount) ||
    (value.eventCount as number) < 0 ||
    (value.endBehavior !== SseEndBehavior.Close &&
      value.endBehavior !== SseEndBehavior.KeepOpen)
  ) {
    return undefined;
  }
  return {
    sessionId: value.sessionId,
    kind: value.kind as SseDebugSendKind,
    eventIndex: value.eventIndex as number,
    event,
    eventCount: value.eventCount as number,
    endBehavior: value.endBehavior,
  };
}

/**
 * 校验 MAIN world 对手动 SSE 命令的处理结果。
 * @param value 未知命令结果
 * @returns 净化后的命令结果；不合法时返回 undefined
 */
export function parseSseDebugCommandResult(
  value: unknown,
): SseDebugCommandResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  /** 命令结果携带的可选会话。 */
  const session = value.session === undefined
    ? undefined
    : parseSseDebugSession(value.session);
  if (value.ok === true && session) {
    return { ok: true, session };
  }
  if (
    value.ok === false &&
    typeof value.reason === 'string' &&
    SSE_DEBUG_COMMAND_FAILURE_REASONS.has(value.reason) &&
    (value.session === undefined || session)
  ) {
    return {
      ok: false,
      reason: value.reason as SseDebugCommandFailureReason,
      ...(session ? { session } : {}),
    };
  }
  return undefined;
}
