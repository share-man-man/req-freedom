import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  CONFIG_EXPORT_SCHEMA_VERSION,
  MatchType,
  MockResponseDelivery,
  MockResponseMode,
  RuleActionType,
  RuleExecutionChannel,
  SseEndBehavior,
} from '@req-freedom/shared';
import { parseConfigurationExport } from './config-transfer';

/** 让校验错误稳定返回 i18n key 的测试翻译函数。 */
const translate = ((key: string) => key) as TFunction;

/**
 * 构造包含一条 SSE Mock 的完整配置文档。
 * @param actionOverrides 要覆盖的 Mock 动作字段
 * @returns 可序列化的配置对象
 */
function configuration(actionOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-08-12T00:00:00.000Z',
    enabled: true,
    groups: [{
      id: 'group',
      name: 'SSE',
      enabled: true,
      updatedAt: '2026-08-12T00:00:00.000Z',
      rules: [{
        id: 'rule',
        name: 'SSE Mock',
        enabled: true,
        channel: RuleExecutionChannel.PagePatch,
        methods: [],
        matchType: MatchType.Contains,
        pattern: '/events',
        actions: [{
          type: RuleActionType.MockResponse,
          mode: MockResponseMode.Static,
          delivery: MockResponseDelivery.Sse,
          statusCode: 200,
          body: '',
          sseEvents: [{ event: 'update', data: 'hello', id: '1', retryMs: 1000, delayMs: 50 }],
          sseEndBehavior: SseEndBehavior.KeepOpen,
          ...actionOverrides,
        }],
      }],
    }],
  };
}

describe('parseConfigurationExport SSE Mock', () => {
  it('保留已校验的事件字段和结束行为', () => {
    /** 解析后的 SSE Mock 动作。 */
    const action = parseConfigurationExport(
      translate,
      JSON.stringify(configuration()),
    ).groups[0].rules[0].actions[0];

    expect(action).toMatchObject({
      delivery: MockResponseDelivery.Sse,
      statusCode: 200,
      sseEndBehavior: SseEndBehavior.KeepOpen,
      sseEvents: [{ event: 'update', data: 'hello', id: '1', retryMs: 1000, delayMs: 50 }],
    });
  });

  it('拒绝动态 SSE、非 200 状态码与空事件列表', () => {
    for (const overrides of [
      { mode: MockResponseMode.Dynamic, functionCode: 'function mock() {}' },
      { statusCode: 204 },
      { sseEvents: [] },
    ]) {
      expect(() => parseConfigurationExport(translate, JSON.stringify(configuration(overrides))))
        .toThrow('configTransfer.invalidMockConfig');
    }
  });
});
