import type {
  MockResponseAction,
  Rule,
  RuleAction,
  RuleHit,
} from '@req-freedom/shared';
import { MockResponseMode, RuleActionType } from '@req-freedom/shared';
import { pickActionByType } from '@req-freedom/core';

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
  /** 本次执行产生的命中记录。 */
  hits: RuleHit[];
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

  /** 本次真正会执行的动作。 */
  const appliedActions = [mock, delay, modifyBody].filter(
    (action): action is NonNullable<typeof action> => action !== undefined,
  );
  /** 与执行动作一一对应的命中记录；同一规则的多个动作各记一条。 */
  const hits = appliedActions.flatMap((action) => {
    /** 该动作所属的业务规则。 */
    const owner = rules.find((rule) => rule.actions.includes(action));
    return owner ? [{ ruleId: owner.id, action: action.type, url, method, at }] : [];
  });

  return { mock, delay, modifyBody, hits };
}
