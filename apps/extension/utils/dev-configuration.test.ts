import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
} from '@req-freedom/shared';
import requestLabConfiguration from '../../../fixtures/request-lab/req-freedom-config.json';

/** browser.storage.local 的测试替身。 */
const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: storageMocks,
    },
  },
}));

import { importRequestLabConfiguration } from './dev-configuration';

describe('importRequestLabConfiguration', () => {
  beforeEach(() => {
    storageMocks.get.mockReset().mockResolvedValue({});
    storageMocks.set.mockReset().mockResolvedValue(undefined);
  });

  it('首次启动时校验并写入 Request Lab 配置', async () => {
    await expect(importRequestLabConfiguration()).resolves.toBe(true);

    expect(storageMocks.set).toHaveBeenCalledWith(expect.objectContaining({
      [STORAGE_KEY_GROUPS]: requestLabConfiguration.groups,
      [STORAGE_KEY_ENABLED]: requestLabConfiguration.enabled,
    }));
  });

  it('fixture 内容未变化时保留当前开发配置', async () => {
    await importRequestLabConfiguration();
    /** 首次导入时生成并写入的配置指纹字段。 */
    const firstWrite = storageMocks.set.mock.calls[0][0] as Record<string, unknown>;
    /** 配置指纹对应的 storage key。 */
    const fingerprintKey = Object.keys(firstWrite).find(
      (key) => key !== STORAGE_KEY_GROUPS && key !== STORAGE_KEY_ENABLED,
    );
    expect(fingerprintKey).toBeDefined();

    storageMocks.set.mockClear();
    storageMocks.get.mockResolvedValue({
      [fingerprintKey as string]: firstWrite[fingerprintKey as string],
    });

    await expect(importRequestLabConfiguration()).resolves.toBe(false);
    expect(storageMocks.set).not.toHaveBeenCalled();
  });
});
