import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  PAGE_MESSAGE_SOURCE,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_RULES,
} from '@req-freedom/shared';
import { getEnabled, getRules } from '@/utils/storage';

/**
 * 桥接内容脚本（ISOLATED world）
 *
 * MAIN world 的拦截脚本无法访问 chrome.storage，
 * 由本脚本读取规则并通过 window.postMessage 推送给页面内的拦截脚本；
 * storage 变化时增量推送，保持页面内规则实时更新。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    /**
     * 读取当前规则与开关并推送到页面
     */
    const pushRulesToPage = async (): Promise<void> => {
      /** 全局开关状态 */
      const enabled = await getEnabled();
      /** 全部业务规则 */
      const rules = await getRules();
      // 通过 postMessage 跨 world 传递（仅当前窗口，不跨源）
      window.postMessage({ source: PAGE_MESSAGE_SOURCE, enabled, rules }, '*');
    };

    // 初始推送
    void pushRulesToPage();

    // storage 变化时重新推送
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }
      if (STORAGE_KEY_RULES in changes || STORAGE_KEY_ENABLED in changes) {
        void pushRulesToPage();
      }
    });
  },
});
