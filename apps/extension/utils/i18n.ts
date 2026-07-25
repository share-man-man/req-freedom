import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { browser } from 'wxt/browser';
import { STORAGE_KEY_LOCALE } from '@req-freedom/shared';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import ja from '@/locales/ja.json';
import ko from '@/locales/ko.json';
import ptBR from '@/locales/pt-BR.json';
import ru from '@/locales/ru.json';
import zhCN from '@/locales/zh-CN.json';
import zhTW from '@/locales/zh-TW.json';

/** 支持的界面语言代码。 */
export const SUPPORTED_LOCALES = [
  'zh-CN',
  'en',
  'zh-TW',
  'ja',
  'ko',
  'es',
  'pt-BR',
  'fr',
  'de',
  'ru',
] as const;

/** 支持的界面语言代码类型。 */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 未持久化语言、也无法匹配浏览器语言时的兜底语言。 */
const FALLBACK_LOCALE: SupportedLocale = 'en';

/**
 * 判断给定值是否为受支持的语言代码。
 * @param value 待判断的值
 * @returns 是否为 SupportedLocale
 */
function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * 把浏览器 UI 语言归一化为受支持的语言代码，用于首次安装时的默认值。
 * @returns 归一化后的语言代码
 */
function detectBrowserLocale(): SupportedLocale {
  /** 浏览器上报的 UI 语言（如 zh-CN / zh-TW / en-US）。 */
  const uiLanguage = browser.i18n.getUILanguage().replace('_', '-').toLowerCase();
  if (uiLanguage.startsWith('zh')) {
    return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/.test(uiLanguage) ? 'zh-TW' : 'zh-CN';
  }
  if (uiLanguage.startsWith('pt')) return 'pt-BR';
  /** 去掉地区后缀的基础语言代码。 */
  const baseLanguage = uiLanguage.split('-')[0];
  return isSupportedLocale(baseLanguage) ? baseLanguage : FALLBACK_LOCALE;
}

/**
 * 从 storage 读取用户上次选择的语言，缺省回落到浏览器语言。
 * @returns 初始化 i18next 应使用的语言代码
 */
async function resolveInitialLocale(): Promise<SupportedLocale> {
  /** storage 中持久化的语言设置。 */
  const result = await browser.storage.local.get(STORAGE_KEY_LOCALE);
  const stored = result[STORAGE_KEY_LOCALE];
  return isSupportedLocale(stored) ? stored : detectBrowserLocale();
}

/**
 * 初始化 i18next 单例：读取持久化语言、装载资源、接入 react-i18next。
 * 各入口（popup / options）渲染前需 await 本函数。
 * @returns 初始化完成的 i18next 实例
 */
export async function initI18n(): Promise<typeof i18next> {
  /** 初始化时使用的语言。 */
  const initialLocale = await resolveInitialLocale();
  await i18next.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
      'zh-TW': { translation: zhTW },
      ja: { translation: ja },
      ko: { translation: ko },
      es: { translation: es },
      'pt-BR': { translation: ptBR },
      fr: { translation: fr },
      de: { translation: de },
      ru: { translation: ru },
    },
    lng: initialLocale,
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false },
  });
  // 跨页面同步：options 与 popup 是独立文档，语言切换需靠 storage.onChanged 互相感知
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    /** 本次变更中语言键的新值。 */
    const nextLocale = changes[STORAGE_KEY_LOCALE]?.newValue;
    if (isSupportedLocale(nextLocale) && nextLocale !== i18next.language) {
      void i18next.changeLanguage(nextLocale);
    }
  });
  return i18next;
}

/**
 * 切换界面语言并持久化到 storage，供 storage.onChanged 同步其他打开中的页面。
 * @param locale 目标语言代码
 */
export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_LOCALE]: locale });
  await i18next.changeLanguage(locale);
}

export { i18next };
