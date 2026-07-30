import type {
  MockResponseAction,
  Rule,
  RuleAction,
  RuleHit,
} from '@req-freedom/shared';
import {
  MockResponseMode,
  RuleActionType,
  RuleHitOutcome,
  RuleHitSkipReason,
} from '@req-freedom/shared';
import { pickActionByType } from '@req-freedom/core';
import { createAppliedHit } from './rule-hit';

/** 延迟动作类型别名。 */
type DelayAction = Extract<RuleAction, { type: RuleActionType.Delay }>;

/** 改请求体动作类型别名。 */
type ModifyRequestBodyAction = Extract<RuleAction, { type: RuleActionType.ModifyRequestBody }>;

/**
 * 本次请求的页面补丁执行计划。
 *
 * 计划里出现的动作就是会被执行的动作，`hits` 是同一次决策的产物而非事后重新推导。
 * 这样统计与执行不可能给出不同答案——旧实现正是因为分两处推导，才会在
 * 「基于真实响应的 Mock + 改请求体」组合下漏记改请求体动作。
 */
export interface PagePlan {
  /** 本次采用的 Mock 动作。 */
  mock?: MockResponseAction;
  /** 本次采用的网络限速动作。 */
  delay?: DelayAction;
  /** 本次真正会执行的改请求体动作；不执行时为 undefined。 */
  modifyBody?: ModifyRequestBodyAction;
  /**
   * 限速与改请求体的命中记录：计划一旦成立这两个动作必定执行，可立即上报。
   */
  hits: RuleHit[];
  /**
   * Mock 的命中记录；命中 Mock 时必定存在，与 `mock` 同生同灭。
   *
   * 单独拿出来是因为它的结果要到执行时才知道：「基于真实响应」的 Mock 遇到不透明响应
   * （no-cors / opaqueredirect）时读不到响应体，只能原样放行——那时这条记录应上报为
   * 「匹配上但未应用」而不是命中。由执行处在确认结果后上报。
   */
  mockHit?: RuleHit;
}

/**
 * 把一条命中记录改写为「匹配上但未应用」。
 *
 * 记录本身仍要保留：日志是原始数据，「规则匹配了却没能生效」正是排查时最需要的信息，
 * 只是它不该被算作命中。
 * @param hit 原命中记录
 * @param reason 无法应用的原因
 * @returns 标记为跳过的同一条记录
 */
export function toSkippedHit(hit: RuleHit, reason: RuleHitSkipReason): RuleHit {
  return { ...hit, outcome: RuleHitOutcome.Skipped, reason };
}

/**
 * 判断 Mock 动作是否为「基于真实响应」模式。
 * @param action 命中的 Mock 动作
 * @returns 需要先发真实请求、再把响应交给动态函数改写时为 true
 */
export function isPassthroughMock(action: MockResponseAction): boolean {
  return action.passthrough === true && action.mode === MockResponseMode.Dynamic;
}

/**
 * 解析本次请求实际要执行的页面补丁动作。
 *
 * 同类动作遵循 pickActionByType 的「首条生效」语义。
 * @param rules 已完成 URL、方法与请求体过滤的页面补丁规则
 * @param url 绝对化后的请求 URL
 * @param method 请求方法
 * @param at 命中记录时间
 * @returns 执行计划及其对应的命中记录
 */
export function resolvePagePlan(
  rules: Rule[],
  url: string,
  method: string,
  at: number,
): PagePlan {
  /** 本次采用的 Mock 动作。 */
  const mock = pickActionByType(rules, RuleActionType.MockResponse);
  /** 本次采用的网络限速动作。 */
  const delay = pickActionByType(rules, RuleActionType.Delay);
  /** 命中的改请求体动作，尚未判断本次是否真的会执行。 */
  const candidateModifyBody = pickActionByType(rules, RuleActionType.ModifyRequestBody);
  // 改请求体只在「真实请求会发出」且「方法允许携带请求体」时执行：
  // 短路 Mock 不发真实请求，基于真实响应的 Mock 仍会发。
  const modifyBody =
    method !== 'GET' && method !== 'HEAD' && (mock === undefined || isPassthroughMock(mock))
      ? candidateModifyBody
      : undefined;

  /**
   * 把一个待执行动作转成命中记录。
   * @param action 本次会执行的动作
   * @returns 该动作的命中记录；找不到所属规则时为 undefined
   */
  const toHit = (action: RuleAction): RuleHit | undefined => {
    /** 该动作所属的业务规则。 */
    const owner = rules.find((rule) => rule.actions.includes(action));
    return owner ? createAppliedHit(owner.id, action.type, { url, method, at }) : undefined;
  };

  /** 计划成立即确定会执行的动作的命中记录。 */
  const hits = [delay, modifyBody]
    .flatMap((action) => (action === undefined ? [] : [action]))
    .flatMap((action) => {
      /** 该动作的命中记录。 */
      const hit = toHit(action);
      return hit ? [hit] : [];
    });

  return { mock, delay, modifyBody, hits, mockHit: mock && toHit(mock) };
}

/**
 * 解析同步 XHR 应上报的「匹配上但未应用」记录。
 *
 * 同步 XHR 要求 `send` 返回时响应已就绪，而页面补丁的处理全是异步的，因此一律原样放行；
 * 规则确实匹配上了，用户需要在 popup 里看到原因，而不是只在控制台看到一行 warn。
 *
 * 带请求体条件的规则先被剔除：判定请求体需要异步读取，同步路径上无从确认，宁可少报也
 * 不误报一条其实没匹配上的规则。
 * @param rules URL 与方法已命中的页面补丁规则
 * @param url 绝对化后的请求 URL
 * @param method 请求方法
 * @param at 记录时间
 * @returns 全部标记为 SyncXhr 跳过的命中记录
 */
export function resolveSyncXhrSkippedHits(
  rules: Rule[],
  url: string,
  method: string,
  at: number,
): RuleHit[] {
  /** 剔除请求体条件后重新解析出的执行计划。 */
  const plan = resolvePagePlan(
    rules.filter((rule) => rule.bodyMatch === undefined),
    url,
    method,
    at,
  );
  return [...plan.hits, ...(plan.mockHit ? [plan.mockHit] : [])].map((hit) =>
    toSkippedHit(hit, RuleHitSkipReason.SyncXhr),
  );
}
