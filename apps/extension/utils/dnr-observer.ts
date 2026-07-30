import { browser } from 'wxt/browser';
import type { RuleHit } from '@req-freedom/shared';
import { RuleHitOutcome } from '@req-freedom/shared';
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
 * 把一次被观测到的请求转换成命中记录。
 *
 * 这是「预测」而非「事实」：DNR 在网络层真正执行，扩展只能用同一份规则重新判定。
 * 判定复用 core.findMatchedRules——与页面补丁通道完全同一个匹配器，不是第二套实现。
 *
 * 动作层面以快照里「实际注册成功的动作」为准，而不是规则声明了哪些动作：非法规则会被
 * 浏览器拒绝、永远不会执行，把它们算作命中等于宣称一条没生效的规则生效了。这份集合同时
 * 编码了「哪些动作类型由 DNR 执行」，因此这里不需要第二处判断。
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
    /** 该规则实际注册到 DNR 的动作类型。 */
    const registeredActions = snapshot.registeredActionsByRuleId.get(rule.id);
    if (!registeredActions) {
      return [];
    }
    return rule.actions
      .filter((action) => registeredActions.has(action.type))
      .map((action) => ({
        ruleId: rule.id,
        action: action.type,
        url: request.url,
        method: request.method,
        at,
        // DNR 在网络层执行，扩展侧无从观察结果；预测出的命中一律按已执行记录
        outcome: RuleHitOutcome.Applied,
      }));
  });
}

/** 顶层文档请求的资源类型。 */
const MAIN_FRAME_TYPE = 'main_frame';

/** 命中观测所需的回调，由 background 注入以更新存储与图标。 */
export interface RuleHitObserverHandlers {
  /** 新的顶层导航开始，需重置该标签页的命中日志。 */
  onNavigationReset: (tabId: number) => void;
  /** 本次请求预测出了命中。 */
  onRuleHits: (tabId: number, hits: RuleHit[]) => void;
}

/** 当前回调；initRuleHitObserver 注入前为空实现，便于监听器持有稳定引用。 */
let handlers: RuleHitObserverHandlers = {
  onNavigationReset: () => undefined,
  onRuleHits: () => undefined,
};

/** 子资源监听当前是否已注册。 */
let subResourceListenerRegistered = false;

/** 各标签页最近一次顶层导航的 requestId，用于识别同一次导航的重定向跳。 */
const lastTopLevelRequestIdByTab = new Map<number, string>();

/**
 * 记录一个被观测请求预测出的命中。
 * @param request 被观测的请求
 */
function recordRequestHits(request: ObservedRequest): void {
  /** 本次请求预测出的命中。 */
  const hits = toRuleHits(request, getActiveDnrRules(), Date.now());
  if (hits.length > 0) {
    handlers.onRuleHits(request.tabId, hits);
  }
}

/**
 * 处理顶层文档请求：先按需重置，再记录本次请求自身的命中。
 *
 * 两件事刻意放在同一个回调里顺序执行。拆成两个监听器时，「重置先于记录」只能依赖
 * 监听器的派发顺序，而 webRequest 并未承诺同一扩展内多个观测监听器的先后；一旦顺序
 * 相反，命中主文档的规则（拦截、Header 改写、重定向）会被紧随其后的重置抹掉，且失败
 * 完全静默。写成两条相邻语句后，顺序由代码结构保证。
 *
 * 重定向跳不算新导航：主文档被重定向时，onBeforeRequest 会以**同一个 requestId** 对新
 * 地址再触发一次，此时若照常重置，上一跳刚记录的重定向命中会被抹掉。requestId 在整个
 * 浏览器会话内唯一且跨重定向保持不变，据此即可判定。
 *
 * 返回 undefined 而非 void：MV3 的 onBeforeRequest 监听器签名仍声明可返回 BlockingResponse，
 * 这里是纯观测，不参与阻断。
 * @param details 被观测的顶层文档请求
 * @returns 始终为 undefined
 */
function onTopLevelRequest(details: ObservedRequest & { requestId: string }): undefined {
  if (details.tabId < 0) {
    return undefined;
  }
  if (lastTopLevelRequestIdByTab.get(details.tabId) !== details.requestId) {
    lastTopLevelRequestIdByTab.set(details.tabId, details.requestId);
    handlers.onNavigationReset(details.tabId);
  }
  recordRequestHits(details);
  return undefined;
}

/**
 * 处理子资源请求；顶层文档请求由常驻监听独占，避免重复计数。
 * @param details 被观测的请求
 * @returns 始终为 undefined
 */
function onSubResourceRequest(details: ObservedRequest & { type: string }): undefined {
  if (details.type === MAIN_FRAME_TYPE) {
    return undefined;
  }
  recordRequestHits(details);
  return undefined;
}

/**
 * 注入回调并注册常驻的顶层文档监听。
 *
 * 该监听不能跟随子资源监听按需注册：没有启用的 DNR 规则时，导航重置逻辑会一并失效。
 * 它每次导航仅触发一次，开销极小；没有规则时规则快照为空，记录一步自然不产生命中。
 * @param nextHandlers 命中与导航重置的处理函数
 */
export function initRuleHitObserver(nextHandlers: RuleHitObserverHandlers): void {
  handlers = nextHandlers;
  browser.webRequest.onBeforeRequest.addListener(onTopLevelRequest, {
    urls: ['<all_urls>'],
    types: [MAIN_FRAME_TYPE],
  });
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
 * 按当前是否存在启用的 DNR 通道规则，注册或注销子资源监听。
 *
 * 没有规则时保持注销，避免无谓地为每个请求唤醒 Service Worker。
 * @param hasActiveRules 当前是否存在启用的 DNR 通道规则
 */
export function syncSubResourceListener(hasActiveRules: boolean): void {
  if (hasActiveRules === subResourceListenerRegistered) {
    return;
  }
  if (hasActiveRules) {
    browser.webRequest.onBeforeRequest.addListener(onSubResourceRequest, {
      urls: ['<all_urls>'],
    });
  } else {
    browser.webRequest.onBeforeRequest.removeListener(onSubResourceRequest);
  }
  subResourceListenerRegistered = hasActiveRules;
}
