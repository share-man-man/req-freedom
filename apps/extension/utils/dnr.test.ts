import { describe, expect, it, vi } from 'vitest';
import type { Rule } from '@req-freedom/shared';

// toDnrRules 只用到 declarativeNetRequest 上的几个枚举常量，node 环境下补齐即可。
vi.mock('wxt/browser', () => ({
  browser: {
    declarativeNetRequest: {
      RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { APPEND: 'append', REMOVE: 'remove', SET: 'set' },
    },
  },
}));
import { HeaderOperation, HeaderTarget, MatchType, RuleActionType, RuleExecutionChannel } from '@req-freedom/shared';
import { toDnrRules } from './dnr';

/**
 * 构造一条待编译的测试规则。
 * @param actions 规则动作
 * @param overrides 需要覆盖的规则字段
 * @returns 字段完整的业务规则
 */
function rule(actions: unknown[], overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    channel: RuleExecutionChannel.Dnr,
    matchType: MatchType.Contains,
    pattern: '/api',
    methods: [],
    actions,
    ...overrides,
  } as Rule;
}

/**
 * 这组测试守护「哪些动作会被编译成 DNR 规则」这一契约。
 *
 * 命中预测已改为以实际注册成功的动作为准，不再另行判断动作类型，因此这份契约是
 * 「DNR 通道会执行哪些动作」的唯一定义处。
 */
describe('toDnrRules', () => {
  it('每个可执行动作各编译一条规则，ID 连续且带回源动作类型', () => {
    const compiled = toDnrRules(
      rule([
        { type: RuleActionType.Block },
        {
          type: RuleActionType.ModifyHeaders,
          headers: [
            { target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'X-A', value: '1' },
          ],
        },
      ]),
      1000,
    );

    expect(compiled.map((item) => item.actionType)).toEqual([
      RuleActionType.Block,
      RuleActionType.ModifyHeaders,
    ]);
    expect(compiled.map((item) => item.dnrRule.id)).toEqual([1000, 1001]);
  });

  it('Header 列表为空的改写动作不编译，因此也不会被计入命中', () => {
    expect(toDnrRules(rule([{ type: RuleActionType.ModifyHeaders, headers: [] }]), 1)).toEqual([]);
  });

  it('页面补丁专属动作不编译', () => {
    expect(toDnrRules(rule([{ type: RuleActionType.MockResponse, statusCode: 200, body: '' }]), 1))
      .toEqual([]);
  });

  it('页面补丁通道的规则整条不编译', () => {
    expect(
      toDnrRules(rule([{ type: RuleActionType.Block }], { channel: RuleExecutionChannel.PagePatch }), 1),
    ).toEqual([]);
  });

  it('作用域解析出的 tabIds 附加到 condition 上', () => {
    const [compiled] = toDnrRules(rule([{ type: RuleActionType.Block }]), 1, [7, 8]);

    expect(compiled?.dnrRule.condition.tabIds).toEqual([7, 8]);
  });
});
