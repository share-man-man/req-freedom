import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDirectory = path.join(extensionDirectory, 'locales');
const manifestLocaleDirectory = path.join(extensionDirectory, 'public', '_locales');

/** 应用语言代码与 Chrome 扩展 locale 目录名的映射。 */
const LOCALE_DIRECTORY_NAMES = {
  'zh-CN': 'zh_CN',
  en: 'en',
  'zh-TW': 'zh_TW',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  'pt-BR': 'pt_BR',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
};

/**
 * 将嵌套翻译对象展开为以点分隔的 key-value Map。
 * @param {unknown} value 当前节点
 * @param {string[]} segments 当前 key 路径
 * @param {Map<string, string>} result 收集结果
 * @returns {Map<string, string>} 展开后的翻译项
 */
function flattenMessages(value, segments = [], result = new Map()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Locale node "${segments.join('.')}" must be an object.`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childSegments = [...segments, key];
    if (typeof child === 'string') {
      result.set(childSegments.join('.'), child);
      continue;
    }
    flattenMessages(child, childSegments, result);
  }
  return result;
}

/**
 * 提取并排序字符串中的 i18next 插值变量。
 * @param {string} message 翻译文案
 * @returns {string[]} 插值变量列表
 */
function getInterpolationTokens(message) {
  return [...message.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

/**
 * 提取并排序字符串中的 HTML 开始/结束标签，避免翻译破坏富文本结构。
 * @param {string} message 翻译文案
 * @returns {string[]} HTML 标签列表
 */
function getHtmlTags(message) {
  return [...message.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)]
    .map((match) => match[0].startsWith('</') ? `/${match[1]}` : match[1])
    .sort();
}

/**
 * 读取 JSON 文件并返回解析结果。
 * @param {string} filePath JSON 文件路径
 * @returns {Promise<unknown>} JSON 内容
 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** 校验失败信息。 */
const errors = [];
const referenceMessages = flattenMessages(await readJson(path.join(localeDirectory, 'en.json')));
const expectedKeys = [...referenceMessages.keys()].sort();

for (const locale of Object.keys(LOCALE_DIRECTORY_NAMES)) {
  const messages = flattenMessages(await readJson(path.join(localeDirectory, `${locale}.json`)));
  const keys = [...messages.keys()].sort();
  const missingKeys = expectedKeys.filter((key) => !messages.has(key));
  const extraKeys = keys.filter((key) => !referenceMessages.has(key));
  if (missingKeys.length > 0) errors.push(`${locale}: missing keys: ${missingKeys.join(', ')}`);
  if (extraKeys.length > 0) errors.push(`${locale}: extra keys: ${extraKeys.join(', ')}`);

  for (const key of expectedKeys) {
    const reference = referenceMessages.get(key);
    const message = messages.get(key);
    if (typeof message !== 'string' || message.trim() === '') {
      errors.push(`${locale}: "${key}" must be a non-empty string`);
      continue;
    }
    const expectedTokens = getInterpolationTokens(reference);
    const actualTokens = getInterpolationTokens(message);
    if (expectedTokens.join() !== actualTokens.join()) {
      errors.push(`${locale}: "${key}" interpolation tokens differ (${actualTokens.join(', ')})`);
    }
    const expectedTags = getHtmlTags(reference);
    const actualTags = getHtmlTags(message);
    if (expectedTags.join() !== actualTags.join()) {
      errors.push(`${locale}: "${key}" HTML tags differ (${actualTags.join(', ')})`);
    }
  }
}

const localeFiles = (await readdir(localeDirectory))
  .filter((fileName) => fileName.endsWith('.json'))
  .map((fileName) => fileName.slice(0, -'.json'.length))
  .sort();
const registeredLocales = Object.keys(LOCALE_DIRECTORY_NAMES).sort();
if (localeFiles.join() !== registeredLocales.join()) {
  errors.push(`Locale files and registered locales differ (${localeFiles.join(', ')})`);
}

const referenceManifestMessages = await readJson(
  path.join(manifestLocaleDirectory, LOCALE_DIRECTORY_NAMES.en, 'messages.json'),
);
const expectedManifestKeys = Object.keys(referenceManifestMessages).sort();
for (const [locale, directoryName] of Object.entries(LOCALE_DIRECTORY_NAMES)) {
  const messages = await readJson(path.join(manifestLocaleDirectory, directoryName, 'messages.json'));
  const keys = Object.keys(messages).sort();
  if (keys.join() !== expectedManifestKeys.join()) {
    errors.push(`${locale}: manifest message keys differ (${keys.join(', ')})`);
  }
  for (const key of expectedManifestKeys) {
    if (typeof messages[key]?.message !== 'string' || messages[key].message.trim() === '') {
      errors.push(`${locale}: manifest message "${key}" must be a non-empty string`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${registeredLocales.length} application and manifest locales.`);
}
