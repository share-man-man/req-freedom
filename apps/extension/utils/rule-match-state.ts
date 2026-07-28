import type { RuleMatchCount } from '@req-freedom/shared';
import {
  mergeRuleMatchCounts,
  parseStoredRuleMatchCounts,
  sumRuleMatchCounts,
} from './rule-match-counts';

/** 单个标签页中页面补丁动作计数与 DNR 明细查询窗口的状态。 */
export interface TabRuleMatchState {
  /** 当前页面或最近一次手动清空开始统计的时间。 */
  since: number;
  /** bridge 为当前顶层 Document 生成的私有实例标识。 */
  documentToken?: string;
  /** 页面补丁通道按业务规则归并的实际动作计数。 */
  pagePatchRuleCounts: RuleMatchCount[];
}

/** 页面补丁动作批次应用到当前 Document 后的结果。 */
export interface AppliedPagePatchRuleCounts {
  /** 合并当前批次后的完整标签页状态。 */
  state: TabRuleMatchState;
  /** 当前批次需要同步增加的浏览器原生动作数。 */
  increment: number;
}

/**
 * 创建或补齐单个标签页的命中状态，兼容旧版 session storage 数据。
 * @param previous 已存储的旧状态
 * @param since 新建状态采用的统计起点
 * @returns 字段完整且累计计数已校验的标签页状态
 */
export function normalizeTabRuleMatchState(
  previous: TabRuleMatchState | undefined,
  since: number = 0,
): TabRuleMatchState {
  return {
    since: typeof previous?.since === 'number' ? previous.since : since,
    ...(typeof previous?.documentToken === 'string'
      ? { documentToken: previous.documentToken }
      : {}),
    pagePatchRuleCounts: parseStoredRuleMatchCounts(previous?.pagePatchRuleCounts),
  };
}

/**
 * 为一个真正开始导航的顶层 Document 创建全新的统计窗口。
 * @param since 顶层导航开始时间
 * @returns 不继承旧 Document token 与页面补丁明细的新状态
 */
export function createNavigatedRuleMatchState(since: number): TabRuleMatchState {
  return normalizeTabRuleMatchState(undefined, since);
}

/**
 * 注册当前顶层 Document，并清除上一 Document 的页面补丁明细。
 * @param previous 当前标签页状态
 * @param documentToken bridge 生成的 Document token
 * @returns token 未变化时返回原对象，否则返回新 Document 状态
 */
export function registerRuleMatchDocumentState(
  previous: TabRuleMatchState,
  documentToken: string,
): TabRuleMatchState {
  if (previous.documentToken === documentToken) {
    return previous;
  }
  return {
    ...previous,
    documentToken,
    pagePatchRuleCounts: [],
  };
}

/**
 * 仅把属于当前 Document 的页面补丁动作批次应用到累计状态。
 * @param previous 当前标签页状态
 * @param documentToken 动作批次携带的 Document token
 * @param ruleCounts 当前批次按业务规则归并的动作数
 * @returns token 过期时返回 undefined，否则返回新状态与原生计数增量
 */
export function applyPagePatchRuleCounts(
  previous: TabRuleMatchState,
  documentToken: string,
  ruleCounts: readonly RuleMatchCount[],
): AppliedPagePatchRuleCounts | undefined {
  if (previous.documentToken !== documentToken) {
    return undefined;
  }
  return {
    state: {
      ...previous,
      pagePatchRuleCounts: mergeRuleMatchCounts(
        previous.pagePatchRuleCounts,
        ruleCounts,
      ),
    },
    increment: sumRuleMatchCounts(ruleCounts),
  };
}

/**
 * 在手动清空时保留当前 Document token，并建立新的 DNR 查询起点。
 * @param previous 清空前的标签页状态
 * @param since 本次清空操作的时间边界
 * @returns 清空页面补丁明细后的新统计窗口
 */
export function clearRuleMatchState(
  previous: TabRuleMatchState,
  since: number,
): TabRuleMatchState {
  return {
    since,
    ...(previous.documentToken ? { documentToken: previous.documentToken } : {}),
    pagePatchRuleCounts: [],
  };
}
