import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { DNR_RULE_ID_OFFSET, STORAGE_KEY_ENABLED, STORAGE_KEY_RULES } from '@req-freedom/shared';
import { toDnrRule } from '@/utils/dnr';
import { getEnabled, getRules } from '@/utils/storage';

/**
 * 将 storage 中的规则同步为 declarativeNetRequest 动态规则
 *
 * 关键步骤：
 * 1. 读取全局开关与规则列表
 * 2. 清空本插件之前注册的全部动态规则
 * 3. 全局开启时，把可由 DNR 承载的规则（拦截/重定向/参数注入/Header 改写）重新注册
 */
async function syncDnrRules(): Promise<void> {
  /** 全局开关状态 */
  const enabled = await getEnabled();
  /** 全部业务规则 */
  const rules = await getRules();

  /** 当前已注册的动态规则，用于全量清除 */
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  /** 需要移除的规则 ID 列表 */
  const removeRuleIds = existing.map((rule) => rule.id);

  /** 需要新增的 DNR 规则列表 */
  const addRules = enabled
    ? rules
        .filter((rule) => rule.enabled)
        .map((rule, index) => toDnrRule(rule, DNR_RULE_ID_OFFSET + index))
        .filter((rule): rule is NonNullable<typeof rule> => rule !== null)
    : [];

  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

export default defineBackground(() => {
  // 启动时同步一次，保证 DNR 规则与 storage 一致
  void syncDnrRules();

  // 规则或全局开关变化时重新同步
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (STORAGE_KEY_RULES in changes || STORAGE_KEY_ENABLED in changes) {
      void syncDnrRules();
    }
  });
});
