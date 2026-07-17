import { browser } from 'wxt/browser';
import type { Rule } from '@req-freedom/shared';
import { STORAGE_KEY_ENABLED, STORAGE_KEY_RULES } from '@req-freedom/shared';

/**
 * 读取全部规则
 * @returns 规则列表，未初始化时返回空数组
 */
export async function getRules(): Promise<Rule[]> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_RULES);
  return (result[STORAGE_KEY_RULES] as Rule[] | undefined) ?? [];
}

/**
 * 保存全部规则（整体覆盖）
 * @param rules 规则列表
 */
export async function saveRules(rules: Rule[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_RULES]: rules });
}

/**
 * 读取全局开关状态
 * @returns 是否启用，默认 true
 */
export async function getEnabled(): Promise<boolean> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_ENABLED);
  return (result[STORAGE_KEY_ENABLED] as boolean | undefined) ?? true;
}

/**
 * 写入全局开关状态
 * @param enabled 是否启用
 */
export async function setEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_ENABLED]: enabled });
}
