import { browser } from 'wxt/browser';
import type { RuleGroup } from '@req-freedom/shared';
import { STORAGE_KEY_ENABLED, STORAGE_KEY_GROUPS } from '@req-freedom/shared';

/**
 * 读取全部规则分组
 * @returns 分组列表，未初始化时返回空数组
 */
export async function getGroups(): Promise<RuleGroup[]> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_GROUPS);
  return (result[STORAGE_KEY_GROUPS] as RuleGroup[] | undefined) ?? [];
}

/**
 * 保存全部规则分组（整体覆盖）
 * @param groups 分组列表
 */
export async function saveGroups(groups: RuleGroup[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_GROUPS]: groups });
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
