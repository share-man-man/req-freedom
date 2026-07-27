import { browser } from 'wxt/browser';
import { STORAGE_KEY_THEME, ThemeMode } from '@req-freedom/shared';

/**
 * 判断未知值是否为可持久化的主题模式。
 * @param value 待校验的存储值
 * @returns 值是否为 ThemeMode
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return Object.values(ThemeMode).includes(value as ThemeMode);
}

/**
 * 将持久化主题同步到当前文档根节点。
 * @param theme 要应用的主题；System 时移除显式覆盖并跟随系统
 */
function applyTheme(theme: ThemeMode): void {
  /** 当前文档的根节点，两个入口均以此承载显式主题覆盖。 */
  const root = document.documentElement;
  root.classList.toggle(ThemeMode.Light, theme === ThemeMode.Light);
  root.classList.toggle(ThemeMode.Dark, theme === ThemeMode.Dark);
}

/**
 * 读取当前页面的主题偏好，而非系统解析后的实际明暗值。
 * @returns 当前持久化主题在文档根节点上的表现；未显式选择时为 System
 */
export function getThemeMode(): ThemeMode {
  if (document.documentElement.classList.contains(ThemeMode.Dark)) {
    return ThemeMode.Dark;
  }
  if (document.documentElement.classList.contains(ThemeMode.Light)) {
    return ThemeMode.Light;
  }
  return ThemeMode.System;
}

/**
 * 初始化主题偏好，并监听其他扩展页面的设置变更。
 * @returns 主题偏好完成初始化时兑现
 */
export async function initTheme(): Promise<void> {
  /** storage 中保存的主题；首次使用时回退为 System。 */
  const result = await browser.storage.local.get(STORAGE_KEY_THEME);
  /** 经过校验后的主题模式，非法或缺省值均回退为 System。 */
  const storedTheme = result[STORAGE_KEY_THEME];
  applyTheme(isThemeMode(storedTheme) ? storedTheme : ThemeMode.System);
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    /** 其他扩展页面刚保存的新主题。 */
    const nextTheme = changes[STORAGE_KEY_THEME]?.newValue;
    applyTheme(isThemeMode(nextTheme) ? nextTheme : ThemeMode.System);
  });
}

/**
 * 保存主题偏好，并立即更新当前页面。
 * @param theme 要持久化的主题模式
 * @returns 主题已写入 storage 时兑现
 */
export async function setTheme(theme: ThemeMode): Promise<void> {
  applyTheme(theme);
  await browser.storage.local.set({ [STORAGE_KEY_THEME]: theme });
}
