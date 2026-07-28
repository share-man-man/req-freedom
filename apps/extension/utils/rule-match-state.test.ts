import { describe, expect, it } from 'vitest';
import {
  applyPagePatchRuleCounts,
  clearRuleMatchState,
  createNavigatedRuleMatchState,
  registerRuleMatchDocumentState,
  type TabRuleMatchState,
} from './rule-match-state';

/** 测试使用的当前 Document 初始状态。 */
const CURRENT_DOCUMENT_STATE: TabRuleMatchState = {
  since: 100,
  documentToken: 'document-current',
  pagePatchRuleCounts: [{ ruleId: 'rule-a', count: 2 }],
};

describe('rule-match-state', () => {
  it('拒绝上一 Document 迟到的页面补丁动作', () => {
    expect(applyPagePatchRuleCounts(
      CURRENT_DOCUMENT_STATE,
      'document-stale',
      [{ ruleId: 'rule-a', count: 1 }],
    )).toBeUndefined();
  });

  it('同一 Document 注册不重置统计，切换 Document 时清除页面补丁明细', () => {
    expect(registerRuleMatchDocumentState(
      CURRENT_DOCUMENT_STATE,
      'document-current',
    )).toBe(CURRENT_DOCUMENT_STATE);
    expect(registerRuleMatchDocumentState(
      CURRENT_DOCUMENT_STATE,
      'document-next',
    )).toEqual({
      since: 100,
      documentToken: 'document-next',
      pagePatchRuleCounts: [],
    });
  });

  it('顶层导航重建窗口，手动清空则保留当前 Document token', () => {
    expect(createNavigatedRuleMatchState(200)).toEqual({
      since: 200,
      pagePatchRuleCounts: [],
    });
    expect(clearRuleMatchState(CURRENT_DOCUMENT_STATE, 300)).toEqual({
      since: 300,
      documentToken: 'document-current',
      pagePatchRuleCounts: [],
    });
  });

  it('合并当前 Document 动作并返回对应的原生计数增量', () => {
    expect(applyPagePatchRuleCounts(
      CURRENT_DOCUMENT_STATE,
      'document-current',
      [
        { ruleId: 'rule-a', count: 1 },
        { ruleId: 'rule-b', count: 3 },
      ],
    )).toEqual({
      state: {
        since: 100,
        documentToken: 'document-current',
        pagePatchRuleCounts: [
          { ruleId: 'rule-a', count: 3 },
          { ruleId: 'rule-b', count: 3 },
        ],
      },
      increment: 4,
    });
  });
});
