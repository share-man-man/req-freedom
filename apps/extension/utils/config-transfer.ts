import type { BodyMatcher, ConfigurationExport, HeaderModification, Rule, RuleAction, RuleGroup } from '@req-freedom/shared';
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
 * @param content 用户选择的文件内容
 * @returns 可安全写入 storage 的配置数据
 */
export function parseConfigurationExport(content: string): ConfigurationExport {
  /** JSON 解析后的未知数据。 */
  let parsed: unknown;
  try { parsed = JSON.parse(content) as unknown; } catch { throw new Error('文件不是有效的 JSON。'); }
  /** 顶层配置对象。 */
  const document = requireRecord(parsed, '配置根节点');
  if (document.schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) throw new Error(`仅支持 schemaVersion ${CONFIG_EXPORT_SCHEMA_VERSION}。`);
  if (typeof document.exportedAt !== 'string' || Number.isNaN(Date.parse(document.exportedAt))) throw new Error('配置文件缺少有效的 exportedAt 时间。');
  if (typeof document.enabled !== 'boolean' || !Array.isArray(document.groups)) throw new Error('配置文件的 enabled 或 groups 格式不正确。');
  /** 已使用的分组 ID。 */
  const groupIds = new Set<string>();
  /** 已使用的规则 ID。 */
  const ruleIds = new Set<string>();
  /** 完成净化的分组数据。 */
  const groups = document.groups.map((group, index) => parseRuleGroup(group, index, groupIds, ruleIds));
  return { schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION, exportedAt: document.exportedAt, enabled: document.enabled, groups };
}

/**
 * 校验普通对象。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认是普通对象的值
 */
function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  return value as UnknownRecord;
}

/**
 * 校验非空字符串字段。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的字符串
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  return value;
}

/**
 * 校验有限非负数字。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的数字
 */
function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label}必须是非负数字。`);
  return value;
}

/**
 * 校验一组字符串键值对。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已校验的键值映射
 */
function parseStringRecord(value: unknown, label: string): Record<string, string> {
  /** 输入对象。 */
  const record = requireRecord(value, label);
  if (Object.values(record).some((item) => typeof item !== 'string')) throw new Error(`${label}中的值必须都是字符串。`);
  return record as Record<string, string>;
}

/**
 * 校验规则分组。
 * @param value 待校验的分组
 * @param index 分组下标
 * @param groupIds 已使用 ID
 * @param ruleIds 已使用规则 ID
 * @returns 已校验分组
 */
function parseRuleGroup(value: unknown, index: number, groupIds: Set<string>, ruleIds: Set<string>): RuleGroup {
  /** 分组对象。 */
  const group = requireRecord(value, `第 ${index + 1} 个分组`);
  /** 分组 ID。 */
  const id = requireString(group.id, '分组 id');
  if (groupIds.has(id)) throw new Error(`分组 ID ${id} 重复。`);
  groupIds.add(id);
  if (typeof group.enabled !== 'boolean' || !Array.isArray(group.rules)) throw new Error(`分组「${id}」格式不正确。`);
  if (typeof group.updatedAt !== 'string' || Number.isNaN(Date.parse(group.updatedAt))) throw new Error(`分组「${id}」缺少有效更新时间。`);
  return { id, name: requireString(group.name, `分组「${id}」名称`), enabled: group.enabled, updatedAt: group.updatedAt, rules: group.rules.map((rule, ruleIndex) => parseRule(rule, id, ruleIndex, ruleIds)) };
}

/**
 * 校验一条统一规则。
 * @param value 待校验规则
 * @param groupId 所属分组 ID
 * @param index 规则下标
 * @param ruleIds 已使用规则 ID
 * @returns 已校验规则
 */
function parseRule(value: unknown, groupId: string, index: number, ruleIds: Set<string>): Rule {
  /** 规则对象。 */
  const rule = requireRecord(value, `分组「${groupId}」中的第 ${index + 1} 条规则`);
  /** 规则 ID。 */
  const id = requireString(rule.id, '规则 id');
  if (ruleIds.has(id)) throw new Error(`规则 ID ${id} 重复。`);
  ruleIds.add(id);
  if (typeof rule.enabled !== 'boolean' || !Object.values(MatchType).includes(rule.matchType as MatchType)) throw new Error(`规则「${id}」的基础字段不合法。`);
  if (!Object.values(RuleExecutionChannel).includes(rule.channel as RuleExecutionChannel)) throw new Error(`规则「${id}」的执行通道不合法。`);
  if (!Array.isArray(rule.methods) || !rule.methods.every((method) => Object.values(HttpMethod).includes(method as HttpMethod))) throw new Error(`规则「${id}」的请求方法不合法。`);
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) throw new Error(`规则「${id}」至少需要一个动作。`);
  /** 匹配内容。 */
  const pattern = requireString(rule.pattern, `规则「${id}」的匹配内容`);
  if (rule.matchType === MatchType.Regex) { try { new RegExp(pattern); } catch { throw new Error(`规则「${id}」的正则表达式语法错误。`); } }
  /** 执行通道。 */
  const channel = rule.channel as RuleExecutionChannel;
  /** 已校验的请求体匹配条件（缺省表示不按请求体收敛）。 */
  const bodyMatch = rule.bodyMatch === undefined ? undefined : parseBodyMatch(rule.bodyMatch, id, channel);
  /** 已校验动作。 */
  const actions = rule.actions.map((action, actionIndex) => parseAction(action, id, actionIndex, channel));
  /** 不能同时执行的 DNR 路由动作数量。 */
  const exclusiveActionCount = actions.filter((action) => [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams].includes(action.type)).length;
  if (exclusiveActionCount > 1) throw new Error(`规则「${id}」不能同时配置拦截、重定向和参数注入。`);
  if (rule.methods.length === 0 || rule.methods.includes(HttpMethod.Get) || rule.methods.includes(HttpMethod.Head)) {
    if (actions.some((action) => action.type === RuleActionType.ModifyRequestBody)) throw new Error(`规则「${id}」的 GET / HEAD 不能改请求体。`);
  }
  return { id, name: requireString(rule.name, `规则「${id}」的名称`), enabled: rule.enabled, channel, methods: rule.methods as HttpMethod[], matchType: rule.matchType as MatchType, ...(bodyMatch ? { bodyMatch } : {}), pattern, actions };
}

/**
 * 校验请求体匹配条件。
 * @param value 待校验的请求体匹配条件
 * @param ruleId 所属规则 ID
 * @param channel 规则执行通道（请求体条件仅页面补丁通道可用）
 * @returns 已校验的请求体匹配条件
 */
function parseBodyMatch(value: unknown, ruleId: string, channel: RuleExecutionChannel): BodyMatcher {
  if (channel !== RuleExecutionChannel.PagePatch) throw new Error(`规则「${ruleId}」的请求体匹配仅页面补丁通道可用。`);
  /** 请求体匹配对象。 */
  const bodyMatch = requireRecord(value, `规则「${ruleId}」的请求体匹配`);
  if (!Object.values(BodyMatchType).includes(bodyMatch.type as BodyMatchType)) throw new Error(`规则「${ruleId}」的请求体匹配方式不合法。`);
  /** 匹配值。 */
  const matchValue = requireString(bodyMatch.value, `规则「${ruleId}」的请求体匹配值`);
  if (bodyMatch.type === BodyMatchType.Regex) { try { new RegExp(matchValue); } catch { throw new Error(`规则「${ruleId}」的请求体匹配正则语法错误。`); } }
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
function parseAction(value: unknown, ruleId: string, index: number, channel: RuleExecutionChannel): RuleAction {
  /** 动作对象。 */
  const action = requireRecord(value, `规则「${ruleId}」的第 ${index + 1} 个动作`);
  if (!Object.values(RuleActionType).includes(action.type as RuleActionType)) throw new Error(`规则「${ruleId}」的动作类型不合法。`);
  /** 动作类型。 */
  const type = action.type as RuleActionType;
  /** 是否是 DNR 动作。 */
  const isDnrAction = [RuleActionType.Block, RuleActionType.Redirect, RuleActionType.InjectParams, RuleActionType.ModifyHeaders].includes(type);
  if ((isDnrAction && channel !== RuleExecutionChannel.Dnr) || (!isDnrAction && channel !== RuleExecutionChannel.PagePatch)) throw new Error(`规则「${ruleId}」的动作与执行通道不匹配。`);
  switch (type) {
    case RuleActionType.Block: return { type };
    case RuleActionType.Redirect: return { type, redirectUrl: requireString(action.redirectUrl, '重定向地址') };
    case RuleActionType.InjectParams: return { type, params: parseStringRecord(action.params, '参数') };
    case RuleActionType.ModifyHeaders: return { type, headers: parseHeaders(action.headers) };
    case RuleActionType.MockResponse:
      if (!Object.values(MockResponseMode).includes(action.mode as MockResponseMode) || typeof action.statusCode !== 'number' || action.statusCode < 100 || action.statusCode > 599 || typeof action.body !== 'string') throw new Error(`规则「${ruleId}」的 Mock 配置不合法。`);
      if (action.mode === MockResponseMode.Dynamic && (typeof action.functionCode !== 'string' || !action.functionCode.trim())) throw new Error(`规则「${ruleId}」的动态 Mock 函数不能为空。`);
      return { type, mode: action.mode as MockResponseMode, statusCode: action.statusCode, body: action.body, ...(Object.values(MockBodyType).includes(action.bodyType as MockBodyType) ? { bodyType: action.bodyType as MockBodyType } : {}), ...(typeof action.functionCode === 'string' ? { functionCode: action.functionCode } : {}), ...(typeof action.delayMs === 'number' ? { delayMs: requireNumber(action.delayMs, 'Mock 延迟') } : {}), ...(action.responseHeaders ? { responseHeaders: parseStringRecord(action.responseHeaders, 'Mock 响应头') } : {}) };
    case RuleActionType.Delay:
      if (!Object.values(NetworkThrottlePreset).includes(action.throttlePreset as NetworkThrottlePreset)) throw new Error(`规则「${ruleId}」的限速档位不合法。`);
      return { type, throttlePreset: action.throttlePreset as NetworkThrottlePreset, latencyMs: requireNumber(action.latencyMs, '网络延迟'), downloadKbps: requireNumber(action.downloadKbps, '下行带宽'), uploadKbps: requireNumber(action.uploadKbps, '上行带宽') };
    case RuleActionType.InsertScript:
      if (!Object.values(InsertScriptCodeType).includes(action.codeType as InsertScriptCodeType) || !Object.values(InsertScriptTiming).includes(action.timing as InsertScriptTiming)) throw new Error(`规则「${ruleId}」的注入配置不合法。`);
      return { type, codeType: action.codeType as InsertScriptCodeType, timing: action.timing as InsertScriptTiming, code: requireString(action.code, '注入代码') };
    case RuleActionType.ModifyRequestBody:
      if (!Object.values(RequestBodySourceMode).includes(action.sourceMode as RequestBodySourceMode) || !Object.values(RequestBodyMode).includes(action.mode as RequestBodyMode) || typeof action.content !== 'string') throw new Error(`规则「${ruleId}」的请求体配置不合法。`);
      if (action.sourceMode === RequestBodySourceMode.Dynamic && (typeof action.functionCode !== 'string' || !action.functionCode.trim())) throw new Error(`规则「${ruleId}」的动态请求体函数不能为空。`);
      return { type, sourceMode: action.sourceMode as RequestBodySourceMode, mode: action.mode as RequestBodyMode, content: action.content, ...(typeof action.functionCode === 'string' ? { functionCode: action.functionCode } : {}) };
  }
}

/**
 * 校验 Header 改写项。
 * @param value 待校验数组
 * @returns 已校验的 Header 修改项
 */
function parseHeaders(value: unknown): HeaderModification[] {
  if (!Array.isArray(value)) throw new Error('Header 修改项必须是数组。');
  return value.map((item) => {
    /** Header 修改对象。 */
    const header = requireRecord(item, 'Header 修改项');
    if (!Object.values(HeaderTarget).includes(header.target as HeaderTarget) || !Object.values(HeaderOperation).includes(header.operation as HeaderOperation)) throw new Error('Header 修改项的目标或操作不合法。');
    return { target: header.target as HeaderTarget, operation: header.operation as HeaderOperation, header: requireString(header.header, 'Header 名称'), ...(typeof header.value === 'string' ? { value: header.value } : {}) };
  });
}
