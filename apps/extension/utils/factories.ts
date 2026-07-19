import type { Rule, RuleGroup } from '@req-freedom/shared';
import {
  DEFAULT_GROUP_NAME,
  DEFAULT_MOCK_STATUS,
  DEFAULT_NETWORK_THROTTLE_PRESET,
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  NETWORK_THROTTLE_PRESET_SETTINGS,
  RequestBodyMode,
  RuleType,
} from '@req-freedom/shared';
import { RULE_TYPE_LABELS } from './labels';

/**
 * 创建一个空的规则分组
 * @param name 分组名称，缺省使用默认名
 * @returns 预填充好的新分组
 */
export function createRuleGroup(name: string = DEFAULT_GROUP_NAME): RuleGroup {
  /** 新分组的创建时间，同时作为首次更新时间。 */
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    // 新建即启用：建分组通常就是要马上往里放规则并生效
    enabled: true,
    updatedAt: createdAt,
    rules: [],
  };
}

/**
 * 按规则类型生成一条示例规则（作为新建规则的模板）
 * @param type 规则类型
 * @returns 预填充好的新规则
 */
export function createSampleRule(type: RuleType): Rule {
  /** 所有规则共享的基础字段 */
  const base = {
    id: crypto.randomUUID(),
    name: `${RULE_TYPE_LABELS[type]}规则`,
    // 新建即启用：用户建规则通常就是要用它，少一步手动开启
    enabled: true,
    matchType: MatchType.Contains,
    pattern: 'example.com/api',
  };

  switch (type) {
    case RuleType.Block:
      return { ...base, type };
    case RuleType.Redirect:
      return { ...base, type, redirectUrl: 'http://localhost:3000/api' };
    case RuleType.InjectParams:
      return { ...base, type, params: { debug: '1' } };
    case RuleType.ModifyHeaders:
      return {
        ...base,
        type,
        headers: [
          {
            target: HeaderTarget.Request,
            operation: HeaderOperation.Set,
            header: 'X-Req-Freedom',
            value: '1',
          },
        ],
      };
    case RuleType.MockResponse:
      return {
        ...base,
        type,
        statusCode: DEFAULT_MOCK_STATUS,
        body: JSON.stringify({ code: 0, data: 'mocked by req-freedom' }),
      };
    case RuleType.Delay: {
      /** 新建规则默认使用 Fast 3G，便于立即模拟常见弱网环境。 */
      const throttleSettings = NETWORK_THROTTLE_PRESET_SETTINGS[DEFAULT_NETWORK_THROTTLE_PRESET];
      return {
        ...base,
        type,
        throttlePreset: DEFAULT_NETWORK_THROTTLE_PRESET,
        latencyMs: throttleSettings.latencyMs,
        downloadKbps: throttleSettings.downloadKbps,
        uploadKbps: throttleSettings.uploadKbps,
      };
    }
    case RuleType.InsertScript:
      return {
        ...base,
        // 注入按页面 URL 命中，示例默认匹配整个站点
        pattern: 'example.com',
        type,
        codeType: InsertScriptCodeType.JavaScript,
        timing: InsertScriptTiming.DocumentEnd,
        code: "console.log('injected by req-freedom');",
      };
    case RuleType.ModifyRequestBody:
      return {
        ...base,
        type,
        // 默认走 JSON 深合并，对应最常见的 GraphQL / 接口参数微调场景
        mode: RequestBodyMode.MergeJson,
        content: JSON.stringify({ injectedBy: 'req-freedom' }, null, 2),
      };
  }
}
