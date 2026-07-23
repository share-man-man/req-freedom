import type { Rule, RuleGroup, RuleTemplate } from '@req-freedom/shared';
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

/**
 * 从常用规则模板实例化一条可落库的规则。
 *
 * 模板 `rule` 是无 id 的纯数据草稿，这里深拷贝一份并补上运行时 id，
 * 避免多次实例化共享同一份嵌套动作 / Header 对象引用。
 * @param template 常用规则模板
 * @returns 补齐 id 的规则草稿，可直接放入分组或交编辑器微调
 */
export function instantiateRuleTemplate(template: RuleTemplate): Rule {
  return { ...structuredClone(template.rule), id: crypto.randomUUID() };
}
