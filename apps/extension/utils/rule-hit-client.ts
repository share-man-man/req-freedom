import { browser } from 'wxt/browser';
import type { RuleHitLog, RuleHitTabSummary } from '@req-freedom/shared';
import {
  RUNTIME_MSG_CLEAR_RULE_HITS,
  RUNTIME_MSG_GET_RULE_HIT_LOG,
  RUNTIME_MSG_LIST_RULE_HIT_TABS,
} from '@req-freedom/shared';

/**
 * 扩展页面向 background 查询命中日志的消息封装。
 *
 * 命中日志的权威存储是 background 的内存，扩展页面只能经消息读取。统计卡片与请求日志面板
 * 都要发同一批消息，消息体在各调用点重复拼写容易写错类型常量，统一收在这里。
 * 三个函数都不吞异常：调用方各自有不同的失败表现（卡片静默、面板显式报错），
 * 由它们决定怎么处理。
 */

/**
 * 查询当前仍有命中日志的标签页概览。
 * @returns 标签页概览列表；background 未响应时为 undefined
 */
export function fetchHitTabSummaries(): Promise<RuleHitTabSummary[] | undefined> {
  return browser.runtime.sendMessage({ type: RUNTIME_MSG_LIST_RULE_HIT_TABS }) as Promise<
    RuleHitTabSummary[] | undefined
  >;
}

/**
 * 读取某个标签页的完整命中日志。
 * @param tabId 目标标签页
 * @returns 该标签页的命中日志；background 未响应时为 undefined
 */
export function fetchHitLog(tabId: number): Promise<RuleHitLog | undefined> {
  return browser.runtime.sendMessage({ type: RUNTIME_MSG_GET_RULE_HIT_LOG, tabId }) as Promise<
    RuleHitLog | undefined
  >;
}

/**
 * 清空某个标签页的命中日志。
 * @param tabId 目标标签页
 * @returns 清空完成后的 Promise
 */
export async function clearTabHits(tabId: number): Promise<void> {
  await browser.runtime.sendMessage({ type: RUNTIME_MSG_CLEAR_RULE_HITS, tabId });
}

/**
 * 汇总各标签页的命中条数。
 * @param summaries 标签页概览列表
 * @returns 全部标签页合计的命中记录条数
 */
export function sumHitRecords(summaries: readonly RuleHitTabSummary[]): number {
  return summaries.reduce((total, summary) => total + summary.total, 0);
}
