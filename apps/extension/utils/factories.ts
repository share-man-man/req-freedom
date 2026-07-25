import type { TFunction } from 'i18next';
import type { Rule, RuleGroup } from '@req-freedom/shared';
import {
  MatchType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import type { RuleTemplate } from '@/utils/templates';

/**
 * 创建一个空的规则分组。
 *
 * 分组名是写入 storage 的用户数据，缺省名称在创建瞬间用当前语言翻译后落库（快照），
 * 不随后续切换界面语言联动改变。
 * @param t 当前语言下的翻译函数
 * @param name 分组名称，缺省使用当前语言下的默认名
 * @returns 预填充好的新分组
 */
export function createRuleGroup(t: TFunction, name?: string): RuleGroup {
  /** 新分组的创建时间，同时作为首次更新时间。 */
  const createdAt = new Date().toISOString();
  return { id: crypto.randomUUID(), name: name ?? t('group.defaultName'), enabled: true, updatedAt: createdAt, rules: [] };
}

/**
 * 创建一条统一规则草稿。
 * @param t 当前语言下的翻译函数
 * @param channel 初始执行通道
 * @returns 可直接在编辑器中完善的新规则
 */
export function createSampleRule(t: TFunction, channel: RuleExecutionChannel = RuleExecutionChannel.Dnr): Rule {
  return {
    id: crypto.randomUUID(),
    name: t('rule.defaultName'),
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
 * 模板 `rule` 是无 id / name 的纯数据草稿，这里深拷贝一份、补上运行时 id，
 * 并用当前语言翻译 `nameKey` 后快照成规则名（写入 storage 后不再随语言切换变化）。
 * @param t 当前语言下的翻译函数
 * @param template 常用规则模板
 * @returns 补齐 id 与 name 的规则草稿，可直接放入分组或交编辑器微调
 */
export function instantiateRuleTemplate(t: TFunction, template: RuleTemplate): Rule {
  return { ...structuredClone(template.rule), id: crypto.randomUUID(), name: t(template.nameKey) };
}
