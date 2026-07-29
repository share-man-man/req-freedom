import { browser } from 'wxt/browser';

/**
 * 有规则生效时徽标显示的标记文本；徽标只表达状态，不表达数量。
 *
 * 用 U+2022 而非 U+25CF：后者字面宽度大，会把徽标背景撑成一大块，视觉上盖住图标。
 */
const ACTIVE_BADGE_TEXT = '•';

/** 徽标背景色，与产品主色一致。 */
const ACTIVE_BADGE_COLOR = '#7c3aed';

/**
 * 初始化徽标样式。
 */
export function initActionIcon(): void {
  void browser.action.setBadgeBackgroundColor({ color: ACTIVE_BADGE_COLOR }).catch((error) => {
    console.error('[req-freedom] 设置徽标颜色失败：', error);
  });
}

/**
 * 按标签页是否有命中刷新徽标状态。
 * @param tabId 标签页 ID
 * @param active 当前标签页是否已有规则生效
 */
export function setActionIconState(tabId: number, active: boolean): void {
  void browser.action
    .setBadgeText({ tabId, text: active ? ACTIVE_BADGE_TEXT : '' })
    .catch(() => {
      // 标签页可能已关闭，忽略即可。
    });
}
