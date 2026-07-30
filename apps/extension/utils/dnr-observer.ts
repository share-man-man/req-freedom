import { browser } from 'wxt/browser';
import type { RuleAction, RuleHit } from '@req-freedom/shared';
import { RuleActionType } from '@req-freedom/shared';
import { findMatchedRules, isRuleScoped } from '@req-freedom/core';
import { getActiveDnrRules, type ActiveDnrRuleSnapshot } from './active-rules-cache';

/** 逐请求匹配所需的最小请求信息，便于把匹配逻辑与浏览器类型解耦。 */
export interface ObservedRequest {
  /** 完整请求 URL。 */
  url: string;
  /** 请求方法。 */
  method: string;
  /** 发起请求的标签页；非标签页请求为 -1。 */
  tabId: number;
}

/**
 * 判断一个业务动作是否会由 DNR 通道实际执行。
 *
 * 与旧实现不同，这里的判断只影响「是否记一条命中」，不再承担 DNR 数字 ID 的对齐职责，
 * 因此判断偏差不会导致规则注册失败。
 * @param action 业务动作
 * @returns 该动作会产生 DNR 执行时为 true
 */
function isDnrHitAction(action: RuleAction): boolean {
  switch (action.type) {
    case RuleActionType.Block:
    case RuleActionType.Redirect:
    case RuleActionType.InjectParams:
      return true;
    case RuleActionType.ModifyHeaders:
      return action.headers.length > 0;
    default:
      return false;
  }
}

/**
 * 把一次被观测到的请求转换成命中记录。
 *
 * 这是「预测」而非「事实」：DNR 在网络层真正执行，扩展只能用同一份规则重新判定。
 * 判定复用 core.findMatchedRules——与页面补丁通道完全同一个匹配器，不是第二套实现。
 * @param request 被观测的请求
 * @param snapshot DNR 通道生效规则快照
 * @param at 记录时间
 * @returns 本次请求产生的命中记录
 */
export function toRuleHits(
  request: ObservedRequest,
  snapshot: ActiveDnrRuleSnapshot,
  at: number,
): RuleHit[] {
  if (request.tabId < 0) {
    return [];
  }
  return findMatchedRules(request.url, request.method, snapshot.rules).flatMap((rule) => {
    // 限定作用域的规则以 DNR 同步时解析出的 tabId 集合为准，避免逐请求查询标签信息。
    if (isRuleScoped(rule) && !snapshot.tabIdsByRuleId.get(rule.id)?.includes(request.tabId)) {
      return [];
    }
    return rule.actions.filter(isDnrHitAction).map((action) => ({
      ruleId: rule.id,
      action: action.type,
      url: request.url,
      method: request.method,
      at,
    }));
  });
}

/** 匹配组监听当前是否已注册。 */
let matchListenerRegistered = false;

/**
 * 匹配组监听器；仅存在启用的 DNR 通道规则时注册。
 *
 * 返回 undefined 而非 void：MV3 的 onBeforeRequest 监听器签名仍声明可返回 BlockingResponse，
 * 这里是纯观测，不参与阻断。
 * @param details 被观测的请求
 * @returns 始终为 undefined
 */
function onMatchableRequest(details: ObservedRequest): undefined {
  /** 本次请求预测出的命中。 */
  const hits = toRuleHits(details, getActiveDnrRules(), Date.now());
  if (hits.length > 0) {
    onRuleHits(details.tabId, hits);
  }
  return undefined;
}

/** 记录命中后的回调，由 background 注入以更新存储与图标。 */
let onRuleHits: (tabId: number, hits: RuleHit[]) => void = () => undefined;

/** 各标签页最近一次顶层导航的 requestId，用于识别同一次导航的重定向跳。 */
const lastTopLevelRequestIdByTab = new Map<number, string>();

/**
 * 注册顶层导航监听，用于在新页面开始加载时重置命中日志。
 *
 * 常驻注册：每个页面仅触发一次，开销极小；且它不能跟随匹配组一起按需注册，
 * 否则没有启用规则时清空逻辑会一并失效。
 *
 * 重定向跳必须与新导航区分开：主文档被重定向时，onBeforeRequest 会以**同一个 requestId**
 * 对新地址再触发一次，若照常重置，刚记录的重定向命中会被自己抹掉——Redirect 与
 * InjectParams 规则命中顶层导航时因此永远统计不到。requestId 在整个浏览器会话内唯一，
 * 且跨重定向保持不变，据此即可判定。
 * @param onTopLevelNavigation 新的顶层导航开始时的回调
 */
export function observeTopLevelNavigation(
  onTopLevelNavigation: (tabId: number) => void,
): void {
  browser.webRequest.onBeforeRequest.addListener(
    (details: { tabId: number; requestId: string }): undefined => {
      if (details.tabId < 0) {
        return undefined;
      }
      if (lastTopLevelRequestIdByTab.get(details.tabId) === details.requestId) {
        return undefined;
      }
      lastTopLevelRequestIdByTab.set(details.tabId, details.requestId);
      onTopLevelNavigation(details.tabId);
      return undefined;
    },
    { urls: ['<all_urls>'], types: ['main_frame'] },
  );
}

/**
 * 丢弃某个标签页的导航跟踪状态。
 *
 * 标签页关闭后其 requestId 不会再出现，留着只会让映射随会话无界增长。
 * @param tabId 标签页 ID
 */
export function forgetTab(tabId: number): void {
  lastTopLevelRequestIdByTab.delete(tabId);
}

/**
 * 设置命中回调。
 * @param handler 命中产生时的处理函数
 */
export function setRuleHitHandler(handler: (tabId: number, hits: RuleHit[]) => void): void {
  onRuleHits = handler;
}

/**
 * 按当前是否存在启用的 DNR 通道规则，注册或注销匹配组监听。
 *
 * 没有规则时保持注销，避免无谓地为每个请求唤醒 Service Worker。
 * @param hasActiveRules 当前是否存在启用的 DNR 通道规则
 */
export function syncMatchListener(hasActiveRules: boolean): void {
  if (hasActiveRules === matchListenerRegistered) {
    return;
  }
  if (hasActiveRules) {
    browser.webRequest.onBeforeRequest.addListener(onMatchableRequest, {
      urls: ['<all_urls>'],
    });
  } else {
    browser.webRequest.onBeforeRequest.removeListener(onMatchableRequest);
  }
  matchListenerRegistered = hasActiveRules;
}
