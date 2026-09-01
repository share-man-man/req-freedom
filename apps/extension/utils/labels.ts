import type { TFunction } from 'i18next';
import {
  BodyMatchType,
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  MockBodyType,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleHitSkipReason,
  RuleScopeType,
} from '@req-freedom/shared';
import { RuleTemplateCategory } from '@/utils/templates';

/**
 * 把规则的请求方法列表格式化成展示文案。
 *
 * 空数组在协议里表示「不限方法」，各处展示都要还原成「全部」文案，故收敛在此。
 * @param t 当前语言下的翻译函数
 * @param methods 规则上的请求方法列表
 * @returns 用 ` / ` 连接的方法名，或「全部」文案
 */
export function formatRuleMethods(t: TFunction, methods: readonly string[]): string {
  return methods.length > 0 ? methods.join(' / ') : t('ruleEditor.methodPicker.all');
}

/**
 * 按当前语言构建全部枚举展示名 Record。
 *
 * 组件内用 `useTranslation()` 取得的 `t` 调用即可；非组件的纯函数（如校验器、摘要文案生成）
 * 也可接收调用方传入的同一个 `t`，避免各处重复调用 `useTranslation()`。
 * @param t 当前语言下的翻译函数
 * @returns 各枚举 → 展示文案的映射集合
 */
export function getLabels(t: TFunction) {
  return {
    /** 常用规则模板归类的展示名。 */
    RULE_TEMPLATE_CATEGORY_LABELS: {
      [RuleTemplateCategory.Cors]: t('label.ruleTemplateCategory.cors'),
      [RuleTemplateCategory.Cache]: t('label.ruleTemplateCategory.cache'),
      [RuleTemplateCategory.Protocol]: t('label.ruleTemplateCategory.protocol'),
      [RuleTemplateCategory.UserAgent]: t('label.ruleTemplateCategory.userAgent'),
    } satisfies Record<RuleTemplateCategory, string>,

    /** 规则动作类型的展示名。 */
    RULE_ACTION_TYPE_LABELS: {
      [RuleActionType.Block]: t('label.ruleActionType.block'),
      [RuleActionType.Redirect]: t('label.ruleActionType.redirect'),
      [RuleActionType.InjectParams]: t('label.ruleActionType.injectParams'),
      [RuleActionType.ModifyHeaders]: t('label.ruleActionType.modifyHeaders'),
      [RuleActionType.MockResponse]: t('label.ruleActionType.mockResponse'),
      [RuleActionType.Delay]: t('label.ruleActionType.delay'),
      [RuleActionType.ModifyRequestBody]: t('label.ruleActionType.modifyRequestBody'),
      [RuleActionType.InsertScript]: t('label.ruleActionType.insertScript'),
    } satisfies Record<RuleActionType, string>,

    /** 规则匹配上却未能应用时，各跳过原因的展示名。 */
    RULE_HIT_SKIP_REASON_LABELS: {
      [RuleHitSkipReason.OpaqueResponse]: t('label.ruleHitSkipReason.opaqueResponse'),
      [RuleHitSkipReason.SyncXhr]: t('label.ruleHitSkipReason.syncXhr'),
    } satisfies Record<RuleHitSkipReason, string>,

    /** 请求体改写模式的展示名 */
    REQUEST_BODY_MODE_LABELS: {
      [RequestBodyMode.Replace]: t('label.requestBodyMode.replace'),
      [RequestBodyMode.MergeJson]: t('label.requestBodyMode.mergeJson'),
    } satisfies Record<RequestBodyMode, string>,

    /** 请求体内容来源的展示名。 */
    REQUEST_BODY_SOURCE_MODE_LABELS: {
      [RequestBodySourceMode.Static]: t('label.requestBodySourceMode.static'),
      [RequestBodySourceMode.Dynamic]: t('label.requestBodySourceMode.dynamic'),
    } satisfies Record<RequestBodySourceMode, string>,

    /** Mock 响应生成方式的展示名。 */
    MOCK_RESPONSE_MODE_LABELS: {
      [MockResponseMode.Static]: t('label.mockResponseMode.static'),
      [MockResponseMode.Dynamic]: t('label.mockResponseMode.dynamic'),
    } satisfies Record<MockResponseMode, string>,

    /** 静态 Mock 响应体类型的展示名。 */
    MOCK_BODY_TYPE_LABELS: {
      [MockBodyType.Json]: 'JSON',
      [MockBodyType.Text]: t('label.mockBodyType.text'),
      [MockBodyType.Html]: 'HTML',
      [MockBodyType.Xml]: 'XML',
      [MockBodyType.JavaScript]: 'JavaScript',
      [MockBodyType.Css]: 'CSS',
    } satisfies Record<MockBodyType, string>,

    /** 网络限速档位的展示文案 */
    NETWORK_THROTTLE_PRESET_LABELS: {
      [NetworkThrottlePreset.Fast3G]: 'Fast 3G',
      [NetworkThrottlePreset.Slow3G]: 'Slow 3G',
      [NetworkThrottlePreset.Custom]: t('label.networkThrottlePreset.custom'),
    } satisfies Record<NetworkThrottlePreset, string>,

    /** 注入代码类型的展示名 */
    INSERT_SCRIPT_CODE_TYPE_LABELS: {
      [InsertScriptCodeType.JavaScript]: 'JavaScript',
      [InsertScriptCodeType.Css]: 'CSS',
    } satisfies Record<InsertScriptCodeType, string>,

    /** 注入时机的展示名 */
    INSERT_SCRIPT_TIMING_LABELS: {
      [InsertScriptTiming.DocumentStart]: t('label.insertScriptTiming.documentStart'),
      [InsertScriptTiming.DocumentEnd]: t('label.insertScriptTiming.documentEnd'),
    } satisfies Record<InsertScriptTiming, string>,

    /** 请求体匹配方式的展示名 */
    BODY_MATCH_TYPE_LABELS: {
      [BodyMatchType.Contains]: t('label.bodyMatchType.contains'),
      [BodyMatchType.Regex]: t('label.bodyMatchType.regex'),
      [BodyMatchType.GraphQlOperation]: t('label.bodyMatchType.graphqlOperation'),
    } satisfies Record<BodyMatchType, string>,

    /** 请求体匹配值输入框的占位提示，随匹配方式变化。 */
    BODY_MATCH_VALUE_PLACEHOLDERS: {
      [BodyMatchType.Contains]: t('label.bodyMatchValuePlaceholder.contains'),
      [BodyMatchType.Regex]: t('label.bodyMatchValuePlaceholder.regex'),
      [BodyMatchType.GraphQlOperation]: t('label.bodyMatchValuePlaceholder.graphqlOperation'),
    } satisfies Record<BodyMatchType, string>,

    /** 规则作用域类型的展示名 */
    RULE_SCOPE_TYPE_LABELS: {
      [RuleScopeType.AllTabs]: t('label.ruleScopeType.allTabs'),
      [RuleScopeType.Tab]: t('label.ruleScopeType.tab'),
      [RuleScopeType.Window]: t('label.ruleScopeType.window'),
      [RuleScopeType.TabGroup]: t('label.ruleScopeType.tabGroup'),
    } satisfies Record<RuleScopeType, string>,

    /** 作用域为空（未选择任何目标对象）时各类型的提示文案 */
    RULE_SCOPE_EMPTY_HINTS: {
      [RuleScopeType.AllTabs]: '',
      [RuleScopeType.Tab]: t('label.ruleScopeEmptyHint.tab'),
      [RuleScopeType.Window]: t('label.ruleScopeEmptyHint.window'),
      [RuleScopeType.TabGroup]: t('label.ruleScopeEmptyHint.tabGroup'),
    } satisfies Record<RuleScopeType, string>,

    /** 匹配方式的展示名 */
    MATCH_TYPE_LABELS: {
      [MatchType.Contains]: t('label.matchType.contains'),
      [MatchType.Equals]: t('label.matchType.equals'),
      [MatchType.Wildcard]: t('label.matchType.wildcard'),
      [MatchType.Regex]: t('label.matchType.regex'),
    } satisfies Record<MatchType, string>,

    /** Header 作用目标的展示名 */
    HEADER_TARGET_LABELS: {
      [HeaderTarget.Request]: t('label.headerTarget.request'),
      [HeaderTarget.Response]: t('label.headerTarget.response'),
    } satisfies Record<HeaderTarget, string>,

    /** Header 操作的展示名 */
    HEADER_OPERATION_LABELS: {
      [HeaderOperation.Set]: t('label.headerOperation.set'),
      [HeaderOperation.Append]: t('label.headerOperation.append'),
      [HeaderOperation.Remove]: t('label.headerOperation.remove'),
    } satisfies Record<HeaderOperation, string>,
  };
}
