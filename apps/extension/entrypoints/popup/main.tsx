import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { browser } from 'wxt/browser';
import { initI18nFromStoredLocale } from '@/utils/i18n';
import { initThemeFromStoredValue } from '@/utils/theme';
import { loadPopupPreferences } from '@/utils/popup-bootstrap';
import App from './App';
import './style.css';

/** i18next 尚未可用时由浏览器 manifest 国际化提供的启动文案键。 */
const BOOTSTRAP_MESSAGE_KEY = {
  loading: 'popupLoading',
  startupFailed: 'popupStartupFailed',
  retry: 'popupRetry',
} as const;

/** popup 的 React 根容器。 */
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Popup root element is missing');
}
/** 复用同一个 React Root，在静态启动骨架与正式应用之间切换。 */
const root = ReactDOM.createRoot(rootElement);
/** HTML 阶段的启动状态节点，在应用 i18next 初始化前使用浏览器语言补充无障碍文案。 */
const loadingStatus = rootElement.querySelector<HTMLElement>('[data-popup-loading]');
loadingStatus?.setAttribute(
  'aria-label',
  browser.i18n.getMessage(BOOTSTRAP_MESSAGE_KEY.loading),
);

/**
 * 渲染无法通过默认偏好恢复的启动错误。
 * @param error 启动失败原因
 */
function renderStartupError(error: unknown): void {
  console.error('[req-freedom] Failed to start popup:', error);
  root.render(
    <React.StrictMode>
      <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm font-medium">
          {browser.i18n.getMessage(BOOTSTRAP_MESSAGE_KEY.startupFailed)}
        </p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
          onClick={() => window.location.reload()}
        >
          {browser.i18n.getMessage(BOOTSTRAP_MESSAGE_KEY.retry)}
        </button>
      </div>
    </React.StrictMode>,
  );
}

/**
 * 初始化 popup 界面偏好并挂载正式应用。
 *
 * HTML 中的静态骨架会一直保留到这里首次 render，storage 较慢时也不会显示空白页面。
 */
async function bootstrapPopup(): Promise<void> {
  /** 一次批量读取到的语言、主题偏好。 */
  const preferences = await loadPopupPreferences();
  if (preferences.error !== undefined) {
    console.error(
      '[req-freedom] Failed to load popup preferences; using defaults:',
      preferences.error,
    );
  }
  initThemeFromStoredValue(preferences.theme);
  /** 使用持久化语言或浏览器 UI 语言初始化的 i18next 实例。 */
  const i18n = await initI18nFromStoredLocale(preferences.locale);
  root.render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </React.StrictMode>,
  );
}

void bootstrapPopup().catch(renderStartupError);
