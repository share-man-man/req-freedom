import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ScopeContext } from '@req-freedom/shared';
import {
  PAGE_MESSAGE_CHANNEL_REQUEST_SOURCE,
  PAGE_PORT_MSG_RULE_HITS,
  PAGE_PORT_MSG_RULES,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_RULE_HIT,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  RuleExecutionChannel,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, filterRulesByScope } from '@req-freedom/core';
import { parseHits } from '@/utils/rule-hit';
import { getEnabled, getGroups } from '@/utils/storage';

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
        if (portEvent.data?.type === PAGE_PORT_MSG_RULE_HITS) {
          forwardRuleHits(portEvent.data.hits);
        }
      };
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
      }
    });

    // 配置变化时通过已建立的私有端口推送最新规则。
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes)) {
        void pushRulesToPage();
      }
    });
  },
});
