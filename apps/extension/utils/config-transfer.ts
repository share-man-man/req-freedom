import type { TFunction } from 'i18next';
import type { BodyMatcher, ConfigurationExport, HeaderModification, Rule, RuleAction, RuleGroup, RuleScope, ScopeTarget } from '@req-freedom/shared';
import {
  BodyMatchType,
  CONFIG_EXPORT_FILE_NAME_PREFIX,
  CONFIG_EXPORT_SCHEMA_VERSION,
  HeaderOperation,
  HeaderTarget,
  HttpMethod,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  MockBodyType,
  MockResponseMode,
  NetworkThrottlePreset,
  RequestBodyMode,
  RequestBodySourceMode,
  RuleActionType,
  RuleExecutionChannel,
  RuleScopeType,
} from '@req-freedom/shared';

/** 运行时待校验的普通对象。 */
type UnknownRecord = Record<string, unknown>;

/**
 * 创建可导出的完整配置快照。
 * @param groups 当前规则分组
 * @param enabled 当前全局开关状态
 * @returns 带 schema 版本与导出时间的配置文件内容
 */
export function createConfigurationExport(groups: RuleGroup[], enabled: boolean): ConfigurationExport {
  return { schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), enabled, groups };
}

/**
 * 生成配置下载文件名。
 * @param exportedAt 导出时间（ISO 8601）
 * @returns 含时间戳的 JSON 文件名
 */
export function getConfigurationExportFileName(exportedAt: string): string {
  /** 文件系统友好的时间戳。 */
  const timestamp = exportedAt.replace(/[:.]/g, '-');
  return `${CONFIG_EXPORT_FILE_NAME_PREFIX}-${timestamp}.json`;
}

/**
 * 解析并校验统一规则模型的配置文件。
 * @param t 当前语言下的翻译函数
 * @param content 用户选择的文件内容
 * @returns 可安全写入 storage 的配置数据
 */
export function parseConfigurationExport(t: TFunction, content: string): ConfigurationExport {
  /** JSON 解析后的未知数据。 */
  let parsed: unknown;
  try { parsed = JSON.parse(content) as unknown; } catch { throw new Error(t('configTransfer.invalidJson')); }
  /** 顶层配置对象。 */
  const document = requireRecord(t, parsed, t('configTransfer.label.configRoot'));
  if (document.schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) throw new Error(t('configTransfer.schemaVersionUnsupported', { version: CONFIG_EXPORT_SCHEMA_VERSION }));
  if (typeof document.exportedAt !== 'string' || Number.isNaN(Date.parse(document.exportedAt))) throw new Error(t('configTransfer.missingExportedAt'));
  if (typeof document.enabled !== 'boolean' || !Array.isArray(document.groups)) throw new Error(t('configTransfer.invalidEnabledOrGroups'));
  /** 已使用的分组 ID。 */
  const groupIds = new Set<string>();
  /** 已使用的规则 ID。 */
  const ruleIds = new Set<string>();
  /** 完成净化的分组数据。 */
  const groups = document.groups.map((group, index) => parseRuleGroup(t, group, index, groupIds, ruleIds));
  return { schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION, exportedAt: document.exportedAt, enabled: document.enabled, groups };
}

/**
 * 校验普通对象。
 * @param t 当前语言下的翻译函数
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认是普通对象的值
 */
function requireRecord(t: TFunction, value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(t('configTransfer.mustBeObject', { label }));
  return value as UnknownRecord;
}

/**
 * 校验非空字符串字段。
 * @param t 当前语言下的翻译函数
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的字符串
 */
function requireString(t: TFunction, value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(t('configTransfer.requiredNonEmpty', { label }));
  return value;
}

/**
 * 校验有限非负数字。
 * @param t 当前语言下的翻译函数
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的数字
 */
function requireNumber(t: TFunction, value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(t('configTransfer.mustBeNonNegativeNumber', { label }));
  return value;
}

/**
 * 校验一组字符串键值对。
 * @param t 当前语言下的翻译函数
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已校验的键值映射
 */
function parseStringRecord(t: TFunction, value: unknown, label: string): Record<string, string> {
  /** 输入对象。 */
  const record = requireRecord(t, value, label);
  if (Object.values(record).some((item) => typeof item !== 'string')) throw new Error(t('configTransfer.valuesMustBeStrings', { label }));
  return record as Record<string, string>;
}

/**
 * 校验规则分组。
 * @param t 当前语言下的翻译函数
 * @param value 待校验的分组
 * @param index 分组下标
 * @param groupIds 已使用 ID
 * @param ruleIds 已使用规则 ID
 * @returns 已校验分组
 */
function parseRuleGroup(t: TFunction, value: unknown, index: number, groupIds: Set<string>, ruleIds: Set<string>): RuleGroup {
  /** 分组对象。 */
  const group = requireRecord(t, value, t('configTransfer.label.nthGroup', { n: index + 1 }));
  /** 分组 ID。 */
  const id = requireString(t, group.id, t('configTransfer.label.groupId'));
  if (groupIds.has(id)) throw new Error(t('configTransfer.duplicateGroupId', { id }));
  groupIds.add(id);
  if (typeof group.enabled !== 'boolean' || !Array.isArray(group.rules)) throw new Error(t('configTransfer.invalidGroupFormat', { id }));
  if (typeof group.updatedAt !== 'string' || Number.isNaN(Date.parse(group.updatedAt))) throw new Error(t('configTransfer.missingGroupUpdatedAt', { id }));
  return { id, name: requireString(t, group.name, t('configTransfer.label.groupName', { id })), enabled: group.enabled, updatedAt: group.updatedAt, rules: group.rules.map((rule, ruleIndex) => parseRule(t, rule, id, ruleIndex, ruleIds)) };
}

/**
 * 校验一条统一规则。
 * @param value 待校验规则
 * @param groupId 所属分组 ID
 * @param index 规则下标
 * @param ruleIds 已使用规则 ID
 * @returns 已校验规则
 */
function parseRule(t: TFunction, value: unknown, groupId: string, index: number, ruleIds: Set<string>): Rule {
  /** 规则对象。 */
  const rule = requireRecord(t, value, t('configTransfer.label.nthRuleInGroup', { groupId, n: index + 1 }));
  /** 规则 ID。 */
  const id = requireString(t, rule.id, t('configTransfer.label.ruleId'));
  if (ruleIds.has(id)) throw new Error(t('configTransfer.duplicateRuleId', { id }));
  ruleIds.add(id);
  if (typeof rule.enabled !== 'boolean' || !Object.values(MatchType).includes(rule.matchType as MatchType)) throw new Error(t('configTransfer.invalidRuleBaseFields', { id }));
  if (!Object.values(RuleExecutionChannel).includes(rule.channel as RuleExecutionChannel)) throw new Error(t('configTransfer.invalidRuleChannel', { id }));
  if (!Array.isArray(rule.methods) || !rule.methods.every((method) => Object.values(HttpMethod).includes(method as HttpMethod))) throw new Error(t('configTransfer.invalidRuleMethods', { id }));
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) throw new Error(t('configTransfer.ruleActionsRequired', { id }));
  /** 匹配内容。 */
  const pattern = requireString(t, rule.pattern, t('configTransfer.label.rulePattern', { id }));
  if (rule.matchType === MatchType.Regex) { try { new RegExp(pattern); } catch { throw new Error(t('configTransfer.invalidRuleRegex', { id })); } }
  /** 执行通道。 */
  const channel = rule.channel as RuleExecutionChannel;
  /** 已校验的请求体匹配条件（缺省表示不按请求体收敛）。 */
  const bodyMatch = rule.bodyMatch === undefined ? undefined : parseBodyMatch(t, rule.bodyMatch, id, channel);
  /** 已校验的作用域条件（缺省或 AllTabs 表示不限制生效范围）。 */
  const scope = rule.scope === undefined ? undefined : parseScope(t, rule.scope, id);
  /** 已校验动作。 */
  const actions = rule.actions.map((action, actionIndex) => parseAction(t, action, id, actionIndex, channel));
  /** 不能同时执行的 DNR 路由动作数量。 */
  const exclusiveActionCount = actions.filter((action) => [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams].includes(action.type)).length;
  if (exclusiveActionCount > 1) throw new Error(t('configTransfer.exclusiveActionsConflict', { id }));
  if (rule.methods.length === 0 || rule.methods.includes(HttpMethod.Get) || rule.methods.includes(HttpMethod.Head)) {
    if (actions.some((action) => action.type === RuleActionType.ModifyRequestBody)) throw new Error(t('configTransfer.getHeadCannotModifyBody', { id }));
  }
  return { id, name: requireString(t, rule.name, t('configTransfer.label.ruleName', { id })), enabled: rule.enabled, channel, methods: rule.methods as HttpMethod[], matchType: rule.matchType as MatchType, ...(bodyMatch ? { bodyMatch } : {}), ...(scope ? { scope } : {}), pattern, actions };
}

/**
 * 校验规则作用域条件。
 *
 * AllTabs 归一化为「无作用域」（返回 undefined，等价于不限制）；其余类型要求至少一个合法目标对象。
 * 目标对象的 id 是浏览器运行时数字 ID，导入到其他会话后可能已失效，运行时按 fail-closed 处理，无需在此拦截。
 * @param value 待校验的作用域条件
 * @param ruleId 所属规则 ID
 * @returns 已校验的作用域条件；AllTabs 时为 undefined
 */
function parseScope(t: TFunction, value: unknown, ruleId: string): RuleScope | undefined {
  /** 作用域对象。 */
  const scope = requireRecord(t, value, t('configTransfer.label.ruleScope', { ruleId }));
  if (!Object.values(RuleScopeType).includes(scope.type as RuleScopeType)) throw new Error(t('configTransfer.invalidScopeType', { ruleId }));
  /** 作用域类型。 */
  const type = scope.type as RuleScopeType;
  if (type === RuleScopeType.AllTabs) return undefined;
  if (!Array.isArray(scope.targets) || scope.targets.length === 0) throw new Error(t('configTransfer.scopeTargetsRequired', { ruleId }));
  /** 已校验的目标对象列表。 */
  const targets: ScopeTarget[] = scope.targets.map((target) => {
    /** 单个目标对象。 */
    const record = requireRecord(t, target, t('configTransfer.label.scopeTarget', { ruleId }));
    if (typeof record.id !== 'number' || !Number.isInteger(record.id)) throw new Error(t('configTransfer.scopeTargetIdMustBeInteger', { ruleId }));
    return { id: record.id, label: typeof record.label === 'string' ? record.label : String(record.id) };
  });
  return { type, targets };
}

/**
 * 校验请求体匹配条件。
 * @param value 待校验的请求体匹配条件
 * @param ruleId 所属规则 ID
 * @param channel 规则执行通道（请求体条件仅页面补丁通道可用）
 * @returns 已校验的请求体匹配条件
 */
function parseBodyMatch(t: TFunction, value: unknown, ruleId: string, channel: RuleExecutionChannel): BodyMatcher {
  if (channel !== RuleExecutionChannel.PagePatch) throw new Error(t('configTransfer.bodyMatchChannelInvalid', { ruleId }));
  /** 请求体匹配对象。 */
  const bodyMatch = requireRecord(t, value, t('configTransfer.label.ruleBodyMatch', { ruleId }));
  if (!Object.values(BodyMatchType).includes(bodyMatch.type as BodyMatchType)) throw new Error(t('configTransfer.invalidBodyMatchType', { ruleId }));
  /** 匹配值。 */
  const matchValue = requireString(t, bodyMatch.value, t('configTransfer.label.ruleBodyMatchValue', { ruleId }));
  if (bodyMatch.type === BodyMatchType.Regex) { try { new RegExp(matchValue); } catch { throw new Error(t('configTransfer.invalidBodyMatchRegex', { ruleId })); } }
  return { type: bodyMatch.type as BodyMatchType, value: matchValue };
}

/**
 * 校验单个规则动作。
 * @param value 待校验动作
 * @param ruleId 所属规则 ID
 * @param index 动作下标
 * @param channel 所属执行通道
 * @returns 已校验动作
 */
function parseAction(t: TFunction, value: unknown, ruleId: string, index: number, channel: RuleExecutionChannel): RuleAction {
  /** 动作对象。 */
  const action = requireRecord(t, value, t('configTransfer.label.nthActionInRule', { ruleId, n: index + 1 }));
  if (!Object.values(RuleActionType).includes(action.type as RuleActionType)) throw new Error(t('configTransfer.invalidActionType', { ruleId }));
  /** 动作类型。 */
  const type = action.type as RuleActionType;
  /** 是否是 DNR 动作。 */
  const isDnrAction = [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams, RuleActionType.ModifyHeaders].includes(type);
  if ((isDnrAction && channel !== RuleExecutionChannel.Dnr) || (!isDnrAction && channel !== RuleExecutionChannel.PagePatch)) throw new Error(t('configTransfer.actionChannelMismatch', { ruleId }));
  switch (type) {
    case RuleActionType.Block: return { type };
    case RuleActionType.Redirect: return { type, redirectUrl: requireString(t, action.redirectUrl, t('configTransfer.label.redirectUrl')) };
    case RuleActionType.InjectParams: return { type, params: parseStringRecord(t, action.params, t('configTransfer.label.params')) };
    case RuleActionType.ModifyHeaders: return { type, headers: parseHeaders(t, action.headers) };
    case RuleActionType.MockResponse:
      if (!Object.values(MockResponseMode).includes(action.mode as MockResponseMode) || typeof action.statusCode !== 'number' || action.statusCode < 100 || action.statusCode > 599 || typeof action.body !== 'string') throw new Error(t('configTransfer.invalidMockConfig', { ruleId }));
      if (action.mode === MockResponseMode.Dynamic && (typeof action.functionCode !== 'string' || !action.functionCode.trim())) throw new Error(t('configTransfer.dynamicMockFunctionRequired', { ruleId }));
      if (action.passthrough !== undefined && typeof action.passthrough !== 'boolean') throw new Error(t('configTransfer.invalidMockPassthrough', { ruleId }));
      // 基于真实响应改写依赖动态函数的 res 入参，静态模式发真实请求再整体丢弃没有意义
      if (action.passthrough === true && action.mode !== MockResponseMode.Dynamic) throw new Error(t('configTransfer.mockPassthroughRequiresDynamic', { ruleId }));
      return { type, mode: action.mode as MockResponseMode, statusCode: action.statusCode, ...(typeof action.statusText === 'string' ? { statusText: action.statusText } : {}), body: action.body, ...(Object.values(MockBodyType).includes(action.bodyType as MockBodyType) ? { bodyType: action.bodyType as MockBodyType } : {}), ...(typeof action.functionCode === 'string' ? { functionCode: action.functionCode } : {}), ...(action.passthrough === true ? { passthrough: true } : {}), ...(typeof action.delayMs === 'number' ? { delayMs: requireNumber(t, action.delayMs, t('configTransfer.label.mockDelay')) } : {}), ...(action.responseHeaders ? { responseHeaders: parseStringRecord(t, action.responseHeaders, t('configTransfer.label.mockResponseHeaders')) } : {}) };
    case RuleActionType.Delay:
      if (!Object.values(NetworkThrottlePreset).includes(action.throttlePreset as NetworkThrottlePreset)) throw new Error(t('configTransfer.invalidThrottlePreset', { ruleId }));
      return { type, throttlePreset: action.throttlePreset as NetworkThrottlePreset, latencyMs: requireNumber(t, action.latencyMs, t('configTransfer.label.networkLatency')), downloadKbps: requireNumber(t, action.downloadKbps, t('configTransfer.label.downloadBandwidth')), uploadKbps: requireNumber(t, action.uploadKbps, t('configTransfer.label.uploadBandwidth')) };
    case RuleActionType.InsertScript:
      if (!Object.values(InsertScriptCodeType).includes(action.codeType as InsertScriptCodeType) || !Object.values(InsertScriptTiming).includes(action.timing as InsertScriptTiming)) throw new Error(t('configTransfer.invalidInsertScriptConfig', { ruleId }));
      return { type, codeType: action.codeType as InsertScriptCodeType, timing: action.timing as InsertScriptTiming, code: requireString(t, action.code, t('configTransfer.label.insertScriptCode')) };
    case RuleActionType.ModifyRequestBody:
      if (!Object.values(RequestBodySourceMode).includes(action.sourceMode as RequestBodySourceMode) || !Object.values(RequestBodyMode).includes(action.mode as RequestBodyMode) || typeof action.content !== 'string') throw new Error(t('configTransfer.invalidRequestBodyConfig', { ruleId }));
      if (action.sourceMode === RequestBodySourceMode.Dynamic && (typeof action.functionCode !== 'string' || !action.functionCode.trim())) throw new Error(t('configTransfer.dynamicRequestBodyFunctionRequired', { ruleId }));
      return { type, sourceMode: action.sourceMode as RequestBodySourceMode, mode: action.mode as RequestBodyMode, content: action.content, ...(typeof action.functionCode === 'string' ? { functionCode: action.functionCode } : {}) };
  }
}

/**
 * 校验 Header 改写项。
 * @param t 当前语言下的翻译函数
 * @param value 待校验数组
 * @returns 已校验的 Header 修改项
 */
function parseHeaders(t: TFunction, value: unknown): HeaderModification[] {
  if (!Array.isArray(value)) throw new Error(t('configTransfer.headersMustBeArray'));
  return value.map((item) => {
    /** Header 修改对象。 */
    const header = requireRecord(t, item, t('configTransfer.label.headerModification'));
    if (!Object.values(HeaderTarget).includes(header.target as HeaderTarget) || !Object.values(HeaderOperation).includes(header.operation as HeaderOperation)) throw new Error(t('configTransfer.invalidHeaderTargetOrOperation'));
    return { target: header.target as HeaderTarget, operation: header.operation as HeaderOperation, header: requireString(t, header.header, t('configTransfer.label.headerName')), ...(typeof header.value === 'string' ? { value: header.value } : {}) };
  });
}
