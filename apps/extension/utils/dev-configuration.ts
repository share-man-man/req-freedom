import type { TFunction } from 'i18next';
import { browser } from 'wxt/browser';
import {
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import { parseConfigurationExport } from './config-transfer';

/** 已导入的 Request Lab 配置内容指纹，仅在开发 profile 中使用。 */
const STORAGE_KEY_DEV_REQUEST_LAB_CONFIG_FINGERPRINT =
  'req-freedom:dev-request-lab-config-fingerprint';
/** 让配置校验错误返回稳定 i18n key 的开发态翻译函数。 */
const translate = ((key: string) => key) as TFunction;

/**
 * 计算配置原文的 SHA-256 指纹。
 * @param source 配置文件的 JSON 原文。
 * @returns 十六进制 SHA-256 指纹。
 */
async function createFingerprint(source: string): Promise<string> {
  /** 配置原文的 UTF-8 字节。 */
  const bytes = new TextEncoder().encode(source);
  /** SHA-256 摘要。 */
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * 在开发构建中导入 Request Lab 配置。
 *
 * 同一份 fixture 只导入一次，避免 background 热重载覆盖开发者的临时修改；fixture 内容变化
 * 后指纹随之变化，下一次 background 初始化会自动重新导入。
 * @returns 本次是否写入了配置。
 */
export async function importRequestLabConfiguration(): Promise<boolean> {
  /** Request Lab 配置模块。 */
  const fixtureModule = await import('../../../fixtures/request-lab/req-freedom-config.json');
  /** 用于校验和计算指纹的稳定 JSON 原文。 */
  const source = JSON.stringify(fixtureModule.default);
  /** 当前 fixture 的内容指纹。 */
  const fingerprint = await createFingerprint(source);
  /** 上一次成功导入的内容指纹。 */
  const stored = await browser.storage.local.get(
    STORAGE_KEY_DEV_REQUEST_LAB_CONFIG_FINGERPRINT,
  );
  if (stored[STORAGE_KEY_DEV_REQUEST_LAB_CONFIG_FINGERPRINT] === fingerprint) {
    return false;
  }

  // 关键步骤：沿用手动导入的完整协议校验，防止失效 fixture 污染扩展存储。
  /** 已完成协议校验与兼容迁移的配置。 */
  const configuration = parseConfigurationExport(translate, source);
  await browser.storage.local.set({
    [STORAGE_KEY_GROUPS]: configuration.groups,
    [STORAGE_KEY_ENABLED]: configuration.enabled,
    [STORAGE_KEY_DEV_REQUEST_LAB_CONFIG_FINGERPRINT]: fingerprint,
  });
  return true;
}
