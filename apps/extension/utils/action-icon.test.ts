import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 徽标 API 收到的调用参数。 */
const action = vi.hoisted(() => ({
  /** setBadgeText 的调用记录。 */
  badgeTextCalls: [] as { tabId?: number; text: string }[],
  /** setBadgeBackgroundColor 的调用记录。 */
  badgeColorCalls: [] as { color: string }[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    action: {
      setBadgeText: async (details: { tabId?: number; text: string }): Promise<void> => {
        action.badgeTextCalls.push(details);
      },
      setBadgeBackgroundColor: async (details: { color: string }): Promise<void> => {
        action.badgeColorCalls.push(details);
      },
    },
  },
}));

import { initActionIcon, setActionIconEnabled, setActionIconState } from './action-icon';

beforeEach(async () => {
  action.badgeTextCalls.length = 0;
  action.badgeColorCalls.length = 0;
  await setActionIconEnabled(true);
  action.badgeTextCalls.length = 0;
});

describe('action icon badge', () => {
  it('初始化徽标背景色', async () => {
    initActionIcon();
    await vi.waitFor(() => expect(action.badgeColorCalls).toEqual([{ color: '#7c3aed' }]));
  });

  it('全局停用后默认与逐标签页徽标均显示 OFF', async () => {
    await setActionIconEnabled(false);
    await setActionIconState(7, true);
    await setActionIconState(8, false);

    expect(action.badgeTextCalls).toEqual([
      { text: 'OFF' },
      { tabId: 7, text: 'OFF' },
      { tabId: 8, text: 'OFF' },
    ]);
  });

  it('重新启用后按标签页命中状态恢复圆点或清空', async () => {
    await setActionIconEnabled(false);
    action.badgeTextCalls.length = 0;

    await setActionIconEnabled(true);
    await setActionIconState(7, true);
    await setActionIconState(8, false);

    expect(action.badgeTextCalls).toEqual([
      { text: '' },
      { tabId: 7, text: '•' },
      { tabId: 8, text: '' },
    ]);
  });
});
