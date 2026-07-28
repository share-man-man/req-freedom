import { describe, expect, it } from 'vitest';
import {
  createDnrRuleIdLookup,
  createEmptyDnrRuleIdRegistry,
  ensureDnrRuleIdRegistry,
  parseDnrRuleIdRegistry,
  type DnrRuleIdentityDescriptor,
} from './dnr-rule-registry';

/** 测试用规则 A 动作身份。 */
const RULE_A_DESCRIPTOR: DnrRuleIdentityDescriptor = {
  actionKey: '["rule-a","redirect",0]',
  legacyKey: 'rule-a:0',
  ruleId: 'rule-a',
};

/** 测试用规则 B 动作身份。 */
const RULE_B_DESCRIPTOR: DnrRuleIdentityDescriptor = {
  actionKey: '["rule-b","modify-headers",0]',
  legacyKey: 'rule-b:0',
  ruleId: 'rule-b',
};

describe('dnr-rule-registry', () => {
  it('规则重新排序后保持已分配 ID 不变', () => {
    /** 首次按 A、B 顺序建立的注册表。 */
    const firstRegistry = ensureDnrRuleIdRegistry(
      createEmptyDnrRuleIdRegistry(),
      [RULE_A_DESCRIPTOR, RULE_B_DESCRIPTOR],
    ).registry;
    /** 再次按 B、A 顺序确保后的注册表。 */
    const reorderedRegistry = ensureDnrRuleIdRegistry(
      firstRegistry,
      [RULE_B_DESCRIPTOR, RULE_A_DESCRIPTOR],
    ).registry;

    expect(reorderedRegistry).toEqual(firstRegistry);
  });

  it('首次分配发生哈希冲突时不受输入顺序和运行环境语言影响', () => {
    /** 使用相同旧版哈希键、强制产生初始 ID 冲突的动作 A。 */
    const collisionA: DnrRuleIdentityDescriptor = {
      actionKey: 'action-a',
      legacyKey: 'same-legacy-key',
      ruleId: 'rule-a',
    };
    /** 使用相同旧版哈希键、强制产生初始 ID 冲突的动作 B。 */
    const collisionB: DnrRuleIdentityDescriptor = {
      actionKey: 'action-b',
      legacyKey: 'same-legacy-key',
      ruleId: 'rule-b',
    };
    /** 按正序首次分配得到的注册表。 */
    const forward = ensureDnrRuleIdRegistry(
      createEmptyDnrRuleIdRegistry(),
      [collisionA, collisionB],
    ).registry;
    /** 按反序首次分配得到的注册表。 */
    const reversed = ensureDnrRuleIdRegistry(
      createEmptyDnrRuleIdRegistry(),
      [collisionB, collisionA],
    ).registry;

    expect(reversed).toEqual(forward);
    expect(forward.entries['action-a']?.dnrRuleId)
      .not.toBe(forward.entries['action-b']?.dnrRuleId);
  });

  it('保留已删除动作 tombstone 以解析历史 DNR 明细', () => {
    /** 同时包含两条规则动作的历史注册表。 */
    const historicalRegistry = ensureDnrRuleIdRegistry(
      createEmptyDnrRuleIdRegistry(),
      [RULE_A_DESCRIPTOR, RULE_B_DESCRIPTOR],
    ).registry;
    /** 当前目录只剩规则 B 时的注册表。 */
    const currentRegistry = ensureDnrRuleIdRegistry(
      historicalRegistry,
      [RULE_B_DESCRIPTOR],
    ).registry;
    /** 历史数字 ID 到业务规则的查询表。 */
    const lookup = createDnrRuleIdLookup(currentRegistry);
    /** 规则 A 已分配的历史数字 ID。 */
    const historicalRuleAId = historicalRegistry.entries[RULE_A_DESCRIPTOR.actionKey].dnrRuleId;

    expect(lookup.get(historicalRuleAId)).toBe('rule-a');
  });

  it('清理重复或越界的持久化数字 ID', () => {
    expect(parseDnrRuleIdRegistry({
      version: 1,
      entries: {
        first: { dnrRuleId: 1_000, ruleId: 'rule-a' },
        duplicate: { dnrRuleId: 1_000, ruleId: 'rule-b' },
        invalid: { dnrRuleId: -1, ruleId: 'rule-c' },
      },
    })).toEqual({
      version: 1,
      entries: {
        first: { dnrRuleId: 1_000, ruleId: 'rule-a' },
      },
    });
  });
});
