import { browser } from 'wxt/browser';
import type { DnrRegistrationIssues, RuleGroup } from '@req-freedom/shared';
import {
  STORAGE_KEY_DNR_ISSUES,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';

/**
 * 读取全部规则分组
 * @returns 分组列表，未初始化时返回空数组
 */
export async function getGroups(): Promise<RuleGroup[]> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_GROUPS);
  /** storage 中保存的原始分组列表。 */
  const storedGroups = (result[STORAGE_KEY_GROUPS] as RuleGroup[] | undefined) ?? [];
  return storedGroups;
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

/**
 * 以一次 storage 写入替换全部可持久化配置，供导入流程使用。
 * @param groups 要替换的规则分组
 * @param enabled 要替换的全局开关状态
 */
export async function saveConfiguration(groups: RuleGroup[], enabled: boolean): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY_GROUPS]: groups,
    [STORAGE_KEY_ENABLED]: enabled,
  });
}

/**
 * 读取 DNR 注册失败记录。
 *
 * 记录由 background 每轮规则同步后写入 storage.session；Service Worker 尚未完成首次同步时
 * 读到空对象，界面据此不显示任何失败提示。
 * @returns 按业务规则 ID 索引的注册失败记录，无失败时为空对象
 */
export async function getDnrIssues(): Promise<DnrRegistrationIssues> {
  /** storage 查询结果 */
  const result = await browser.storage.session.get(STORAGE_KEY_DNR_ISSUES);
  return (result[STORAGE_KEY_DNR_ISSUES] as DnrRegistrationIssues | undefined) ?? {};
}

/**
 * 订阅 DNR 注册失败记录的变化。
 *
 * 规则改动后 background 会重新同步并覆盖该记录，界面借此即时反映最新结果，无需轮询。
 * @param onChange 记录变化时的回调
 * @returns 取消订阅的函数
 */
export function watchDnrIssues(
  onChange: (issues: DnrRegistrationIssues) => void,
): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'session' || !(STORAGE_KEY_DNR_ISSUES in changes)) {
      return;
    }
    onChange((changes[STORAGE_KEY_DNR_ISSUES]?.newValue as DnrRegistrationIssues | undefined) ?? {});
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
