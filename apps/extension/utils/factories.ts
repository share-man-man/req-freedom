import type { Rule, RuleGroup } from '@req-freedom/shared';
import {
  DEFAULT_GROUP_NAME,
  MatchType,
  RuleExecutionChannel,
} from '@req-freedom/shared';

/**
 * 创建一个空的规则分组。
 * @param name 分组名称，缺省使用默认名
 * @returns 预填充好的新分组
 */
export function createRuleGroup(name: string = DEFAULT_GROUP_NAME): RuleGroup {
  /** 新分组的创建时间，同时作为首次更新时间。 */
  const createdAt = new Date().toISOString();
  return { id: crypto.randomUUID(), name, enabled: true, updatedAt: createdAt, rules: [] };
}

/**
 * 创建一条统一规则草稿。
 * @param channel 初始执行通道
 * @returns 可直接在编辑器中完善的新规则
 */
export function createSampleRule(channel: RuleExecutionChannel = RuleExecutionChannel.Dnr): Rule {
  return {
    id: crypto.randomUUID(),
    name: '新规则',
    enabled: true,
    channel,
    methods: [],
    matchType: MatchType.Contains,
    pattern: 'example.com/api',
    actions: [],
  };
}
