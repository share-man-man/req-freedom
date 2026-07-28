import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { RuleMatchCount, ScopeContext } from '@req-freedom/shared';
import {
  PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE,
  PAGE_PORT_MSG_RULE_ACTIONS,
  PAGE_PORT_MSG_RULES,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_RULE_MATCH_DOCUMENT_STARTED,
  RUNTIME_MSG_RULE_MATCHED,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  RuleExecutionChannel,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, filterRulesByScope } from '@req-freedom/core';
import {
  mergeRuleMatchCounts,
  parseRuleMatchCounts,
} from '@/utils/rule-match-counts';
import { getEnabled, getGroups } from '@/utils/storage';

/** 页面补丁动作在 bridge 中的批量发送窗口。 */
const RULE_ACTION_BATCH_DELAY_MS = 100;

/**
 * 为当前顶层 Document 创建不可预测的 bridge 实例标识。
 *
 * 使用在非安全页面也可用的 getRandomValues，避免 HTTP 页面缺少 randomUUID。
 * @returns 128 位十六进制 Document token
 */
function createDocumentToken(): string {
  /** 当前 Document token 使用的四个 32 位随机值。 */
  const randomValues = crypto.getRandomValues(new Uint32Array(4));
  return [...randomValues]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * 桥接内容脚本（ISOLATED world）
 *
 * MAIN world 的拦截脚本无法访问扩展 API。本脚本在 document_start 接受 interceptor
 * 发起的首个 MessageChannel，并通过私有端口双向传递规则与动作计数，避免宿主页伪造
 * window.postMessage 命中消息。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    /** bridge 为当前顶层 Document 生成、仅扩展上下文可见的实例标识。 */
    const documentToken = createDocumentToken();
    /** 当前标签作用域上下文；未知时只下发 AllTabs 规则。 */
    let scopeContext: ScopeContext = {};
    /** 与 MAIN world interceptor 建立的私有消息端口。 */
    let pagePort: MessagePort | undefined;
    /** 当前允许通过页面补丁通道上报动作的业务规则 ID。 */
    let activePageRuleIds = new Set<string>();
    /** 批量窗口内累计的页面补丁动作。 */
    let pendingRuleCounts: RuleMatchCount[] = [];
    /** 当前批量发送定时器。 */
    let ruleActionBatchTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * 把待发送动作批次转交 background。
     */
    const flushRuleActionBatch = (): void => {
      if (ruleActionBatchTimer !== undefined) {
        clearTimeout(ruleActionBatchTimer);
        ruleActionBatchTimer = undefined;
      }
      /** 本次真正发送的页面补丁动作批次。 */
      const ruleCounts = pendingRuleCounts;
      pendingRuleCounts = [];
      if (ruleCounts.length === 0) {
        return;
      }
      void browser.runtime.sendMessage({
        type: RUNTIME_MSG_RULE_MATCHED,
        documentToken,
        ruleCounts,
      }).catch(() => undefined);
    };

    /**
     * 校验并合并 MAIN world 上报的页面补丁动作。
     * @param value 私有 MessagePort 收到的未知计数字段
     */
    const queueRuleActionBatch = (value: unknown): void => {
      /** 通过协议字段校验并限幅的动作计数。 */
      const parsedCounts = parseRuleMatchCounts(value);
      /** 只保留当前作用域内实际启用的页面补丁规则。 */
      const allowedCounts = parsedCounts.filter((item) =>
        activePageRuleIds.has(item.ruleId),
      );
      if (allowedCounts.length === 0) {
        return;
      }
      pendingRuleCounts = mergeRuleMatchCounts(pendingRuleCounts, allowedCounts);
      if (ruleActionBatchTimer === undefined) {
        ruleActionBatchTimer = setTimeout(
          flushRuleActionBatch,
          RULE_ACTION_BATCH_DELAY_MS,
        );
      }
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
        if (portEvent.data?.type === PAGE_PORT_MSG_RULE_ACTIONS) {
          queueRuleActionBatch(portEvent.data.ruleCounts);
        }
      };
      pagePort.start();
      void pushRulesToPage();
    });

    // 独立注册 Document token；导航后 background 会拒绝旧 Document 的迟到消息。
    void browser.runtime.sendMessage({
      type: RUNTIME_MSG_RULE_MATCH_DOCUMENT_STARTED,
      documentToken,
    }).catch(() => undefined);
    void refreshScopeContext().then(pushRulesToPage);

    // 标签归组或跨窗口移动后刷新作用域过滤。
    browser.runtime.onMessage.addListener((message) => {
      /** 携带最新作用域上下文的消息。 */
      const scopeMessage = message as { type?: string; context?: ScopeContext } | undefined;
      if (scopeMessage?.type === RUNTIME_MSG_SCOPE_CONTEXT_CHANGED && scopeMessage.context) {
        scopeContext = scopeMessage.context;
        void pushRulesToPage();
      }
    });

    // 配置变化时通过已建立的私有端口推送最新规则。
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes)) {
        void pushRulesToPage();
      }
    });

    // 页面销毁前立即提交剩余批次，缩小短页面漏计窗口。
    window.addEventListener('pagehide', flushRuleActionBatch, { once: true });
  },
});
