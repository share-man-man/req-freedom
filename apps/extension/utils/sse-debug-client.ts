import { browser } from 'wxt/browser';
import type { SseDebugSendNextCommand, SseDebugSession } from '@req-freedom/shared';
import {
  RUNTIME_MSG_LIST_SSE_SESSIONS,
  RUNTIME_MSG_SSE_SEND_NEXT,
  RUNTIME_MSG_SSE_SESSION_CHANGED,
  parseSseDebugCommandResult,
  parseSseDebugSession,
} from '@req-freedom/shared';

/**
 * 查询当前标签页 bridge 保存的 SSE 调试连接。
 * @param tabId popup 当前关联的标签页 ID
 * @returns 当前页面中的运行时会话
 */
export async function listSseDebugSessions(tabId: number): Promise<SseDebugSession[]> {
  /** 当前标签页 bridge 返回的未知会话快照。 */
  const sessions = await browser.tabs.sendMessage(tabId, {
    type: RUNTIME_MSG_LIST_SSE_SESSIONS,
  }, { frameId: 0 }) as unknown;
  if (!Array.isArray(sessions)) {
    throw new Error('SSE debug session list unavailable');
  }
  return sessions.flatMap((session) => {
    /** 共享协议净化后的单条页面会话。 */
    const parsedSession = parseSseDebugSession(session);
    return parsedSession ? [parsedSession] : [];
  });
}

/**
 * 请求当前会话立即发送一条 SSE 事件。
 *
 * 事件内容随 popup 命令发送，而不是由页面运行时再次读取配置；调用方负责使用当前会话游标
 * 和用户确认后的事件字段构造命令。
 * @param tabId 目标会话所在的当前标签页 ID
 * @param input 会话标识、游标和当前事件快照
 * @returns 命令执行后的最新会话
 */
export async function sendNextSseDebugSession(
  tabId: number,
  input: SseDebugSendNextCommand,
): Promise<SseDebugSession> {
  /** 当前标签页 bridge 对控制命令的未知确认结果。 */
  const rawResult = await browser.tabs.sendMessage(tabId, {
    type: RUNTIME_MSG_SSE_SEND_NEXT,
    ...input,
  }, { frameId: 0 }) as unknown;
  /** 共享协议净化后的命令结果。 */
  const result = parseSseDebugCommandResult(rawResult);
  if (!result?.ok) {
    throw new Error(result?.reason ?? 'SSE debug command failed');
  }
  return result.session;
}

/**
 * 订阅任意 SSE 调试会话变化通知。
 *
 * 通知只作为“快照已变化”的信号，调用方重新查询当前页面 bridge，避免 popup
 * 依靠增量消息拼接出错误状态。
 * @param listener 收到变化信号后的回调
 * @returns 取消订阅函数
 */
export function subscribeSseDebugSessions(listener: () => void): () => void {
  /** runtime 消息监听器。 */
  const handleMessage = (message: unknown): undefined => {
    /** 消息的可选类型字段。 */
    const messageType = (message as { type?: unknown } | undefined)?.type;
    if (messageType === RUNTIME_MSG_SSE_SESSION_CHANGED) {
      listener();
    }
    return undefined;
  };
  browser.runtime.onMessage.addListener(handleMessage);
  return () => browser.runtime.onMessage.removeListener(handleMessage);
}
