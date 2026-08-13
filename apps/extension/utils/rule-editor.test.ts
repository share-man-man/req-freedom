import { describe, expect, it } from 'vitest';
import type { Rule } from '@req-freedom/shared';
import {
  HttpMethod,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import { normalizeRuleDraft } from '@/entrypoints/options/RuleEditor';

describe('normalizeRuleDraft', () => {
  it('保存前自动移除匹配内容首尾的空白', () => {
    /** 带有首尾空白的规则草稿。 */
    const rule: Rule = {
      id: 'rule-1',
      name: '测试规则',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [HttpMethod.Get],
      matchType: MatchType.Contains,
      pattern: '  /api/users  \n',
      actions: [{ type: RuleActionType.Block }],
    };

    expect(normalizeRuleDraft(rule).pattern).toBe('/api/users');
    expect(rule.pattern).toBe('  /api/users  \n');
  });
});
