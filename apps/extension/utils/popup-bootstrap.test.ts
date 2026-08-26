import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY_LOCALE, STORAGE_KEY_THEME } from '@req-freedom/shared';

/** popup bootstrap 测试使用的 storage.local.get 假实现。 */
const storage = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: storage.get },
    },
  },
}));

import { loadPopupPreferences } from './popup-bootstrap';

beforeEach(() => {
  storage.get.mockReset();
});

describe('loadPopupPreferences', () => {
  it('一次读取语言与主题设置', async () => {
    storage.get.mockResolvedValue({
      [STORAGE_KEY_LOCALE]: 'zh-CN',
      [STORAGE_KEY_THEME]: 'dark',
    });

    /** popup 启动读取到的界面偏好。 */
    const preferences = await loadPopupPreferences();

    expect(storage.get).toHaveBeenCalledOnce();
    expect(storage.get).toHaveBeenCalledWith([STORAGE_KEY_LOCALE, STORAGE_KEY_THEME]);
    expect(preferences).toEqual({ locale: 'zh-CN', theme: 'dark' });
  });

  it('storage 读取失败时返回空偏好供入口回退', async () => {
    /** 模拟浏览器 storage 暂时不可用的错误。 */
    const error = new Error('storage unavailable');
    storage.get.mockRejectedValue(error);

    await expect(loadPopupPreferences()).resolves.toEqual({
      locale: undefined,
      theme: undefined,
      error,
    });
  });
});
