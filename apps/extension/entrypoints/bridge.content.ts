import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ScopeContext } from '@req-freedom/shared';
import {
  PAGE_MESSAGE_SOURCE,
  RUNTIME_MSG_GET_SCOPE_CONTEXT,
  RUNTIME_MSG_SCOPE_CONTEXT_CHANGED,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { collectActiveRules, filterRulesByScope } from '@req-freedom/core';
import { getEnabled, getGroups } from '@/utils/storage';

/**
 * 桥接内容脚本（ISOLATED world）
 *
 * MAIN world 的拦截脚本无法访问 chrome.storage，
 * 由本脚本读取规则并通过 window.postMessage 推送给页面内的拦截脚本；
 * storage 变化时增量推送，保持页面内规则实时更新。
 *
 * 作用域过滤也在此完成：内容脚本拿不到自己的 tabId，先向 background 请求自身标签上下文
 * （tabId / windowId / groupId），据此把「限定作用域」的规则过滤掉后再推给页面拦截脚本。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    /**
     * 当前标签的作用域上下文。
     *
     * 初始为空对象——此时 matchScope 只会命中 AllTabs 规则，作用域规则一律不下发，
     * 保证「上下文未知」时限定范围的规则不会误生效（fail closed）。
     */
    let scopeContext: ScopeContext = {};

    /**
     * 读取当前规则与开关，按作用域过滤后推送到页面
     */
    const pushRulesToPage = async (): Promise<void> => {
      /** 全局开关状态 */
      const enabled = await getEnabled();
      /** 全部规则分组 */
      const groups = await getGroups();
      /** 当前生效规则（启用分组下的启用规则），分组停用状态已在此处过滤 */
      const activeRules = collectActiveRules(groups);
      /** 作用域命中当前标签的规则；上下文未知时仅保留 AllTabs 规则 */
      const rules = filterRulesByScope(activeRules, scopeContext);
      // 通过 postMessage 跨 world 传递（仅当前窗口，不跨源）
      window.postMessage({ source: PAGE_MESSAGE_SOURCE, enabled, rules }, '*');
    };

    /**
     * 向 background 请求当前标签的作用域上下文并缓存
     */
    const refreshScopeContext = async (): Promise<void> => {
      try {
        /** background 依据 sender.tab 回传的作用域上下文。 */
        const context = (await browser.runtime.sendMessage({
          type: RUNTIME_MSG_GET_SCOPE_CONTEXT,
        })) as ScopeContext | undefined;
        if (context) {
          scopeContext = context;
        }
      } catch {
        // background 未就绪或无响应时保持空上下文，仅下发 AllTabs 规则
      }
    };

    // 初始：先取上下文，再按作用域过滤推送
    void refreshScopeContext().then(pushRulesToPage);

    // background 在标签归组 / 跨窗口移动后主动推送最新上下文，据此重新过滤并推送
    browser.runtime.onMessage.addListener((message) => {
      /** 携带最新作用域上下文的消息。 */
      const scopeMessage = message as { type?: string; context?: ScopeContext } | undefined;
      if (scopeMessage?.type === RUNTIME_MSG_SCOPE_CONTEXT_CHANGED && scopeMessage.context) {
        scopeContext = scopeMessage.context;
        void pushRulesToPage();
      }
    });

    // storage 变化时重新推送（作用域上下文沿用缓存）
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }
      if (STORAGE_KEY_GROUPS in changes || STORAGE_KEY_ENABLED in changes) {
        void pushRulesToPage();
      }
    });
  },
});
