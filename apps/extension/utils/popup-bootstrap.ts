import { browser } from 'wxt/browser';
import { STORAGE_KEY_LOCALE, STORAGE_KEY_THEME } from '@req-freedom/shared';

/** popup 启动时一次性读取的界面偏好。 */
export interface PopupPreferences {
  /** 持久化语言原始值；缺省或读取失败时为 undefined。 */
  locale: unknown;
  /** 持久化主题原始值；缺省或读取失败时为 undefined。 */
  theme: unknown;
  /** storage 读取失败原因；成功时为 undefined。 */
  error?: unknown;
}

/**
 * 一次读取 popup 首次渲染需要的全部界面偏好。
 *
 * 读取失败时返回空偏好而不是抛错，让调用方以浏览器语言和系统主题继续启动。
 * @returns 持久化偏好及可选的读取错误
 */
export async function loadPopupPreferences(): Promise<PopupPreferences> {
  try {
    /** storage 中与首次渲染相关的全部设置。 */
    const stored = await browser.storage.local.get([STORAGE_KEY_LOCALE, STORAGE_KEY_THEME]);
    return {
      locale: stored[STORAGE_KEY_LOCALE],
      theme: stored[STORAGE_KEY_THEME],
    };
  } catch (error) {
    return { locale: undefined, theme: undefined, error };
  }
}
