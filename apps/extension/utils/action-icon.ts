import { browser } from 'wxt/browser';

/**
 * 有规则生效时徽标显示的标记文本；徽标只表达状态，不表达数量。
 *
 * 用 U+2022 而非 U+25CF：后者字面宽度大，会把徽标背景撑成一大块，视觉上盖住图标。
 */
const ACTIVE_BADGE_TEXT = '•';

/** 全局停用时徽标显示的状态文本。 */
const DISABLED_BADGE_TEXT = 'OFF';

/** 徽标背景色，与产品主色一致。 */
const ACTIVE_BADGE_COLOR = '#7c3aed';

/** 当前全局开关状态，供标签页级刷新时决定徽标文本。 */
let globallyEnabled = true;

/**
 * 初始化徽标样式。
 */
export function initActionIcon(): void {
  void browser.action.setBadgeBackgroundColor({ color: ACTIVE_BADGE_COLOR }).catch((error) => {
    console.error('[req-freedom] 设置徽标颜色失败：', error);
  });
}

/**
 * 刷新工具栏图标的全局开关状态。
 *
 * 默认徽标会被之后新建的标签页继承；已有标签页可能保留自己的覆盖值，
 * 由调用方逐页调用 setActionIconState 同步。
 * @param enabled 全局是否启用
 * @returns 徽标更新完成后的 Promise
 */
export async function setActionIconEnabled(enabled: boolean): Promise<void> {
  globallyEnabled = enabled;
  try {
    await browser.action.setBadgeText({ text: enabled ? '' : DISABLED_BADGE_TEXT });
  } catch (error) {
    console.error('[req-freedom] 设置全局徽标状态失败：', error);
  }
}

/**
 * 按全局开关与标签页是否有命中刷新徽标状态。
 * @param tabId 标签页 ID
 * @param active 当前标签页是否已有规则生效
 * @returns 徽标更新完成后的 Promise
 */
export async function setActionIconState(tabId: number, active: boolean): Promise<void> {
  try {
    await browser.action.setBadgeText({
      tabId,
      text: globallyEnabled ? (active ? ACTIVE_BADGE_TEXT : '') : DISABLED_BADGE_TEXT,
    });
  } catch {
    // 标签页可能已关闭，忽略即可。
  }
}
