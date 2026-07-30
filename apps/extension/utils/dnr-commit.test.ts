import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rule } from '@req-freedom/shared';

// compileEntries 经 toDnrRules 用到 declarativeNetRequest 上的几个枚举常量，node 环境下补齐即可。
vi.mock('wxt/browser', () => ({
  browser: {
    declarativeNetRequest: {
      RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { APPEND: 'append', REMOVE: 'remove', SET: 'set' },
    },
  },
}));
import { DNR_RULE_ID_OFFSET, MatchType, RuleActionType, RuleExecutionChannel } from '@req-freedom/shared';
import {
  commitDnr,
  compileEntries,
  mergeCommitResults,
  toRegisteredActions,
  type DnrEntry,
  type DnrRule,
  type DnrUpdateArg,
} from './dnr-commit';

/**
 * 构造一条 DNR 通道的测试规则。
 * @param id 规则 ID
 * @param actions 规则动作
 * @returns 字段完整的业务规则
 */
function rule(id: string, actions: unknown[]): Rule {
  return {
    id,
    name: id,
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType: MatchType.Contains,
    pattern: '/api',
    methods: [],
    actions,
  } as Rule;
}

/** 一条同时包含拦截与重定向的规则。 */
const TWO_ACTION_RULE = rule('two', [
  { type: RuleActionType.Block },
  { type: RuleActionType.Redirect, redirectUrl: 'https://y/api' },
]);

/** 当前已注册的规则，供 commitDnr 读取以做全量清除。 */
let existingRules: DnrRule[] = [];

/** 记录每次 update 调用的入参，用于断言提交方式。 */
let updateCalls: DnrUpdateArg[] = [];

/** 提交时应当失败的 DNR 规则 ID 与报错。 */
let rejectByDnrId = new Map<number, string>();

/**
 * 假的 updateDynamicRules / updateSessionRules。
 *
 * 与浏览器一致：整批提交时只要有一条非法就整批拒绝，逐条提交则只拒绝那一条。
 * @param arg 提交入参
 * @returns 提交完成后的 Promise
 */
async function update(arg: DnrUpdateArg): Promise<void> {
  updateCalls.push(arg);
  for (const dnrRule of arg.addRules ?? []) {
    /** 该 DNR 规则被拒绝的原因。 */
    const message = rejectByDnrId.get(dnrRule.id);
    if (message) {
      throw new Error(message);
    }
  }
}

/**
 * 提交一批 entries。
 * @param entries 待注册的配对列表
 * @returns 提交结果
 */
function commit(entries: DnrEntry[]) {
  return commitDnr(async () => existingRules, update, entries, '测试');
}

/**
 * 把成功动作集合摊平成便于断言的普通对象。
 * @param registered 逐规则的成功动作集合
 * @returns 规则 ID 到动作类型数组的映射
 */
function toPlainActions(
  registered: Map<string, Set<RuleActionType>>,
): Record<string, RuleActionType[]> {
  return Object.fromEntries([...registered].map(([ruleId, actions]) => [ruleId, [...actions]]));
}

beforeEach(() => {
  existingRules = [];
  updateCalls = [];
  rejectByDnrId = new Map();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('compileEntries', () => {
  it('逐规则连续分配 DNR ID，并把每条 DNR 规则归回源规则与源动作', () => {
    const entries = compileEntries([TWO_ACTION_RULE, rule('one', [{ type: RuleActionType.Block }])]);

    expect(entries.map((entry) => [entry.rule.id, entry.actionType, entry.dnrRule.id])).toEqual([
      ['two', RuleActionType.Block, DNR_RULE_ID_OFFSET],
      ['two', RuleActionType.Redirect, DNR_RULE_ID_OFFSET + 1],
      ['one', RuleActionType.Block, DNR_RULE_ID_OFFSET + 2],
    ]);
  });

  it('作用域解析出的 tabIds 附加到编译结果上', () => {
    const entries = compileEntries(
      [rule('scoped', [{ type: RuleActionType.Block }])],
      new Map([['scoped', [42]]]),
    );

    expect(entries[0]?.dnrRule.condition.tabIds).toEqual([42]);
  });
});

describe('commitDnr', () => {
  it('整批提交成功时一次提交完成，全部动作计入注册成功', async () => {
    const result = await commit(compileEntries([TWO_ACTION_RULE]));

    expect(updateCalls).toHaveLength(1);
    expect(toPlainActions(result.registeredActionsByRuleId)).toEqual({
      two: [RuleActionType.Block, RuleActionType.Redirect],
    });
    expect(result.issues).toEqual({});
  });

  it('提交前清除已注册的旧规则', async () => {
    existingRules = [{ id: 1 }, { id: 2 }] as DnrRule[];

    await commit(compileEntries([TWO_ACTION_RULE]));

    expect(updateCalls[0]?.removeRuleIds).toEqual([1, 2]);
  });

  it('整批被拒时降级逐条注册，合法动作照常生效、非法动作单独记账', async () => {
    /** 第二个动作（重定向）非法。 */
    rejectByDnrId.set(DNR_RULE_ID_OFFSET + 1, 'invalid redirect');

    const result = await commit(compileEntries([TWO_ACTION_RULE]));

    expect(toPlainActions(result.registeredActionsByRuleId)).toEqual({
      two: [RuleActionType.Block],
    });
    expect(result.issues.two?.actions).toEqual([RuleActionType.Redirect]);
    expect(result.issues.two?.message).toContain('invalid redirect');
  });

  it('同一规则多个动作被拒时，动作与原因都完整保留', async () => {
    rejectByDnrId.set(DNR_RULE_ID_OFFSET, 'bad block');
    rejectByDnrId.set(DNR_RULE_ID_OFFSET + 1, 'bad redirect');

    const result = await commit(compileEntries([TWO_ACTION_RULE]));

    expect(result.registeredActionsByRuleId.size).toBe(0);
    expect(result.issues.two?.actions).toEqual([RuleActionType.Block, RuleActionType.Redirect]);
    expect(result.issues.two?.message).toContain('bad block');
    expect(result.issues.two?.message).toContain('bad redirect');
  });

  it('同一原因不重复拼接', async () => {
    rejectByDnrId.set(DNR_RULE_ID_OFFSET, 'same reason');
    rejectByDnrId.set(DNR_RULE_ID_OFFSET + 1, 'same reason');

    const result = await commit(compileEntries([TWO_ACTION_RULE]));

    expect(result.issues.two?.message.match(/same reason/g)).toHaveLength(1);
  });

  it('一条规则非法不影响其他规则', async () => {
    rejectByDnrId.set(DNR_RULE_ID_OFFSET, 'bad');

    const result = await commit(
      compileEntries([
        rule('bad', [{ type: RuleActionType.Block }]),
        rule('good', [{ type: RuleActionType.Block }]),
      ]),
    );

    expect(toPlainActions(result.registeredActionsByRuleId)).toEqual({
      good: [RuleActionType.Block],
    });
    expect(Object.keys(result.issues)).toEqual(['bad']);
  });
});

describe('mergeCommitResults', () => {
  it('合并两套规则集的成功动作与失败记录', async () => {
    /** 动态规则集：一条规则整条成功。 */
    const dynamic = await commit(compileEntries([rule('a', [{ type: RuleActionType.Block }])]));
    rejectByDnrId.set(DNR_RULE_ID_OFFSET, 'bad');
    /** session 规则集：唯一一条规则被拒。 */
    const session = await commit(compileEntries([rule('b', [{ type: RuleActionType.Block }])]));

    const merged = mergeCommitResults([dynamic, session]);

    expect(toPlainActions(merged.registeredActionsByRuleId)).toEqual({ a: [RuleActionType.Block] });
    expect(merged.issues.b?.actions).toEqual([RuleActionType.Block]);
  });

  it('空结果合并出空视图', () => {
    const merged = mergeCommitResults([]);

    expect(merged.registeredActionsByRuleId.size).toBe(0);
    expect(merged.issues).toEqual({});
  });
});

describe('toRegisteredActions', () => {
  it('同一规则的多个动作归并到一个集合', () => {
    const registered = toRegisteredActions(compileEntries([TWO_ACTION_RULE]));

    expect(toPlainActions(registered)).toEqual({
      two: [RuleActionType.Block, RuleActionType.Redirect],
    });
  });
});
