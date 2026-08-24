import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type {
  ScopeContext,
  SseDebugCommandResult,
  SseDebugSession,
} from '@req-freedom/shared';
import {
  PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE,
  PAGE_PORT_MSG_RULE_HITS,
  PAGE_PORT_MSG_RULES,
  PAGE_PORT_MSG_SSE_COMMAND_RESULT,
  PAGE_PORT_MSG_SSE_SEND_NEXT,
  PAGE_PORT_MSG_SSE_SESSION_OPENED,
  PAGE_PORT_MSG_SSE_SESSION_UPDATED,
  MAX_SSE_DEBUG_SESSIONS_PER_PAGE,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_LIST_SSE_SESSIONS,
  RUNTIME_MSG_RULE_HIT,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  RUNTIME_MSG_SSE_SEND_NEXT,
  RUNTIME_MSG_SSE_SESSION_CHANGED,
  RuleExecutionChannel,
  SSE_DEBUG_COMMAND_TIMEOUT_MS,
  SseDebugCommandFailureReason,
  SseDebugSessionStatus,
  parseSseDebugCommandResult,
  parseSseDebugSession,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, filterRulesByScope } from '@req-freedom/core';
import { parseHits } from '@/utils/rule-hit';
import { createRuntimeId } from '@/utils/runtime-id';
import { getEnabled, getGroups } from '@/utils/storage';

/** bridge 中等待 MAIN world 回应的一条手动 SSE 命令。 */
interface PendingSseCommand {
  /** 解除 runtime 消息 Promise 的函数。 */
  resolve: (result: SseDebugCommandResult) => void;
  /** 防止页面端口失效后永久挂起的超时定时器。 */
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * 桥接内容脚本（ISOLATED world）
 *
 * MAIN world 的拦截脚本无法访问扩展 API。本脚本在 document_start 接受 interceptor
 * 发起的首个 MessageChannel，并通过私有端口双向传递规则与命中记录，避免宿主页伪造
 * window.postMessage 命中消息。
 *
 * 命中逐条转交、不做批量：批量窗口会让命中在导航后才送达 background，从而需要额外的
 * Document token 去识别迟到消息；逐条转发后消息顺序天然正确，那套机制不再需要。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    /** 当前标签作用域上下文；未知时只下发 AllTabs 规则。 */
    let scopeContext: ScopeContext = {};
    /** 与 MAIN world interceptor 建立的私有消息端口。 */
    let pagePort: MessagePort | undefined;
    /** 当前允许通过页面补丁通道上报命中的业务规则 ID。 */
    let activePageRuleIds = new Set<string>();
    /** 等待 MAIN world 返回 ACK 的手动 SSE 命令。 */
    const pendingSseCommands = new Map<string, PendingSseCommand>();
    /** 当前页面已通过打开消息校验的手动 SSE 会话快照。 */
    const sseSessions = new Map<string, SseDebugSession>();

    /**
     * 校验 MAIN world 上报的命中并转交 background。
     * @param value 私有 MessagePort 收到的未知命中字段
     */
    const forwardRuleHits = (value: unknown): void => {
      /** 通过协议字段校验并限量的命中记录；记录时间取接收时刻，不采信页面上报的值。 */
      const hits = parseHits(value, Date.now()).filter((hit) => activePageRuleIds.has(hit.ruleId));
      if (hits.length === 0) {
        return;
      }
      void browser.runtime.sendMessage({ type: RUNTIME_MSG_RULE_HIT, hits }).catch(() => undefined);
    };

    /**
     * 校验并保存 MAIN world 上报的 SSE 页面会话。
     * @param value 私有 MessagePort 收到的页面会话
     * @param opened 是否为首次打开消息
     */
    const forwardSseSession = (value: unknown, opened: boolean): void => {
      /** 共享协议净化后的页面会话。 */
      const session = parseSseDebugSession(value);
      if (!session) {
        return;
      }
      if (opened) {
        if (!activePageRuleIds.has(session.ruleId)) {
          return;
        }
        if (sseSessions.size >= MAX_SSE_DEBUG_SESSIONS_PER_PAGE) {
          /** 已保留快照中建立时间最早的会话 ID。 */
          const oldestSessionId = [...sseSessions.values()]
            .sort((left, right) => left.connectedAt - right.connectedAt)[0]?.id;
          if (oldestSessionId) {
            sseSessions.delete(oldestSessionId);
          }
        }
      } else if (sseSessions.get(session.id)?.ruleId !== session.ruleId) {
        return;
      }
      if (session.status === SseDebugSessionStatus.Closed) {
        sseSessions.delete(session.id);
      } else {
        sseSessions.set(session.id, session);
      }
      void browser.runtime.sendMessage({
        type: RUNTIME_MSG_SSE_SESSION_CHANGED,
      }).catch(() => undefined);
    };

    /**
     * 用失败结果解除所有等待中的命令，供端口异常时统一清理。
     */
    const rejectPendingSseCommands = (): void => {
      for (const pending of pendingSseCommands.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve({ ok: false, reason: SseDebugCommandFailureReason.Unavailable });
      }
      pendingSseCommands.clear();
    };

    /**
     * 将 popup 发给当前标签页的命令交给 MAIN world，并等待明确 ACK。
     * @param message runtime 收到的命令对象
     * @returns MAIN world 的命令结果；端口不可用或超时时返回 unavailable
     */
    const forwardSseCommand = (message: unknown): Promise<SseDebugCommandResult> => {
      if (!pagePort || typeof message !== 'object' || message === null || Array.isArray(message)) {
        return Promise.resolve({
          ok: false,
          reason: SseDebugCommandFailureReason.Unavailable,
        });
      }
      /** 用于关联 MAIN world ACK 的命令 ID。 */
      const commandId = createRuntimeId();
      return new Promise((resolve) => {
        /** 命令超过等待窗口后返回不可用，避免 runtime 消息永久挂起。 */
        const timeoutId = setTimeout(() => {
          pendingSseCommands.delete(commandId);
          resolve({ ok: false, reason: SseDebugCommandFailureReason.Unavailable });
        }, SSE_DEBUG_COMMAND_TIMEOUT_MS);
        pendingSseCommands.set(commandId, { resolve, timeoutId });
        try {
          pagePort?.postMessage({
            ...(message as Record<string, unknown>),
            type: PAGE_PORT_MSG_SSE_SEND_NEXT,
            commandId,
          });
        } catch {
          clearTimeout(timeoutId);
          pendingSseCommands.delete(commandId);
          resolve({ ok: false, reason: SseDebugCommandFailureReason.Unavailable });
        }
      });
    };

    /**
     * 读取开关与规则，按作用域过滤后通过私有端口推送给 MAIN world。
     */
    const pushRulesToPage = async (): Promise<void> => {
      /** 全局开关状态。 */
      const enabled = await getEnabled();
      /** 全部规则分组。 */
      const groups = await getGroups();
      /** 当前启用分组下的启用规则。 */
      const activeRules = collectActiveRules(groups);
      /** 作用域命中当前标签页的规则。 */
      const rules = filterRulesByScope(activeRules, scopeContext);
      activePageRuleIds = new Set(
        rules
          .filter((rule) => rule.channel === RuleExecutionChannel.PagePatch)
          .map((rule) => rule.id),
      );
      pagePort?.postMessage({ type: PAGE_PORT_MSG_RULES, enabled, rules });
    };

    /**
     * 向 background 请求当前标签页作用域上下文。
     */
    const refreshScopeContext = async (): Promise<void> => {
      try {
        /** background 依据 sender.tab 返回的作用域上下文。 */
        const context = (await browser.runtime.sendMessage({
          type: RUNTIME_MSG_GET_SCOPE_CONTEXT,
        })) as ScopeContext | undefined;
        if (context) {
          scopeContext = context;
        }
      } catch {
        // background 未就绪时保持空上下文，限定作用域规则 fail closed。
      }
    };

    // interceptor 在 MAIN world 启动后发起一次 MessageChannel 握手；只接受首个有效端口。
    window.addEventListener('message', (event: MessageEvent) => {
      if (
        pagePort !== undefined ||
        event.source !== window ||
        event.data?.source !== PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE
      ) {
        return;
      }
      /** interceptor 转移给 bridge 的私有端口。 */
      const [candidatePort] = event.ports;
      if (!candidatePort) {
        return;
      }
      pagePort = candidatePort;
      pagePort.onmessage = (portEvent: MessageEvent) => {
        /** MAIN world 私有端口消息的类型。 */
        const messageType = portEvent.data?.type;
        if (messageType === PAGE_PORT_MSG_RULE_HITS) {
          forwardRuleHits(portEvent.data.hits);
          return;
        }
        if (
          messageType === PAGE_PORT_MSG_SSE_SESSION_OPENED ||
          messageType === PAGE_PORT_MSG_SSE_SESSION_UPDATED
        ) {
          forwardSseSession(
            portEvent.data.session,
            messageType === PAGE_PORT_MSG_SSE_SESSION_OPENED,
          );
          return;
        }
        if (messageType === PAGE_PORT_MSG_SSE_COMMAND_RESULT) {
          /** MAIN world 回传的命令关联 ID。 */
          const commandId = portEvent.data.commandId;
          if (typeof commandId !== 'string') {
            return;
          }
          /** 等待该命令结果的 runtime 请求。 */
          const pending = pendingSseCommands.get(commandId);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timeoutId);
          pendingSseCommands.delete(commandId);
          /** 共享协议净化后的 MAIN world 命令结果。 */
          const result = parseSseDebugCommandResult(portEvent.data.result);
          pending.resolve(result ?? {
            ok: false,
            reason: SseDebugCommandFailureReason.Unavailable,
          });
        }
      };
      pagePort.onmessageerror = rejectPendingSseCommands;
      pagePort.start();
      void pushRulesToPage();
    });

    void refreshScopeContext().then(pushRulesToPage);

    // 标签归组或跨窗口移动后刷新作用域过滤。
    browser.runtime.onMessage.addListener((message) => {
      /** 携带最新作用域上下文的消息。 */
      const scopeMessage = message as { type?: string; context?: ScopeContext } | undefined;
      if (scopeMessage?.type === RUNTIME_MSG_SCOPE_CONTEXT_CHANGED && scopeMessage.context) {
        scopeContext = scopeMessage.context;
        void pushRulesToPage();
        return undefined;
      }
      if (scopeMessage?.type === RUNTIME_MSG_LIST_SSE_SESSIONS) {
        // runtime.onMessage 只把 Promise 或 sendResponse 视为响应；普通数组返回值会被忽略。
        return Promise.resolve([...sseSessions.values()]);
      }
      if (scopeMessage?.type === RUNTIME_MSG_SSE_SEND_NEXT) {
        return forwardSseCommand(message);
      }
      return undefined;
    });

    // 配置变化时通过已建立的私有端口推送最新规则。
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes)) {
        void pushRulesToPage();
      }
    });
  },
});
