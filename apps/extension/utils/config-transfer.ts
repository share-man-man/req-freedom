import type {
  ConfigurationExport,
  HeaderModification,
  Rule,
  RuleGroup,
} from '@req-freedom/shared';
import {
  CONFIG_EXPORT_FILE_NAME_PREFIX,
  CONFIG_EXPORT_SCHEMA_VERSION,
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  NetworkThrottlePreset,
  RuleType,
} from '@req-freedom/shared';

/** 运行时待校验的普通对象。 */
type UnknownRecord = Record<string, unknown>;

/**
 * 创建可导出的完整配置快照。
 * @param groups 当前规则分组
 * @param enabled 当前全局开关状态
 * @returns 带 schema 版本与导出时间的配置文件内容
 */
export function createConfigurationExport(
  groups: RuleGroup[],
  enabled: boolean,
): ConfigurationExport {
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    enabled,
    groups,
  };
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
 * 解析并严格校验导入的 JSON 配置。
 * @param content 用户选择的文件内容
 * @returns 可安全写入 storage 的配置数据
 * @throws 文件不是 JSON、schema 版本不支持或数据结构不合法时抛出错误
 */
export function parseConfigurationExport(content: string): ConfigurationExport {
  /** JSON 解析后的未知数据。 */
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('文件不是有效的 JSON。');
  }

  /** 顶层配置对象。 */
  const document = requireRecord(parsed, '配置根节点');
  if (document.schemaVersion !== 1 && document.schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) {
    throw new Error(
      `暂不支持 schemaVersion ${String(document.schemaVersion)}，当前仅支持版本 1 和 ${CONFIG_EXPORT_SCHEMA_VERSION}。`,
    );
  }
  if (typeof document.exportedAt !== 'string' || Number.isNaN(Date.parse(document.exportedAt))) {
    throw new Error('配置文件缺少有效的 exportedAt 时间。');
  }
  /** 已通过格式校验的导出时间。 */
  const exportedAt = document.exportedAt;
  if (typeof document.enabled !== 'boolean') {
    throw new Error('配置文件中的全局开关 enabled 必须是布尔值。');
  }
  if (!Array.isArray(document.groups)) {
    throw new Error('配置文件中的 groups 必须是数组。');
  }

  /** 已使用的分组 ID，避免导入后拖拽与编辑定位异常。 */
  const groupIds = new Set<string>();
  /** 已使用的规则 ID，避免 DNR 动态规则映射冲突。 */
  const ruleIds = new Set<string>();
  /** 校验并净化后的分组数据。 */
  const groups = document.groups.map((group, index) => {
    /** 当前分组的校验结果。 */
    const parsedGroup = parseRuleGroup(group, index, groupIds, ruleIds, exportedAt);
    return parsedGroup;
  });

  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    exportedAt,
    enabled: document.enabled,
    groups,
  };
}

/**
 * 校验普通对象。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认是普通对象的值
 */
function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}必须是对象。`);
  }
  return value as UnknownRecord;
}

/**
 * 校验非空字符串字段。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的非空字符串
 */
function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}不能为空。`);
  }
  return value;
}

/**
 * 校验有限的非负数字字段。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 已确认的数字
 */
function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须是非负数字。`);
  }
  return value;
}

/**
 * 校验字符串映射。
 * @param value 待校验值
 * @param label 出错时显示的字段名称
 * @returns 键和值均为字符串的映射
 */
function parseStringRecord(value: unknown, label: string): Record<string, string> {
  /** 待处理的对象。 */
  const record = requireRecord(value, label);
  /** 已校验的键值项。 */
  const entries = Object.entries(record);
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new Error(`${label}中的值必须都是字符串。`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * 校验一个规则分组及其规则。
 * @param value 待校验分组
 * @param index 分组在列表中的下标
 * @param groupIds 已使用的分组 ID
 * @param ruleIds 已使用的规则 ID
 * @param fallbackUpdatedAt 旧版导入文件缺少更新时间时使用的回退时间
 * @returns 已校验分组
 */
function parseRuleGroup(
  value: unknown,
  index: number,
  groupIds: Set<string>,
  ruleIds: Set<string>,
  fallbackUpdatedAt: string,
): RuleGroup {
  /** 当前分组对象。 */
  const group = requireRecord(value, `第 ${index + 1} 个分组`);
  /** 当前分组 ID。 */
  const id = requireNonEmptyString(group.id, `第 ${index + 1} 个分组的 id`);
  if (groupIds.has(id)) {
    throw new Error(`分组 ID ${id} 重复。`);
  }
  groupIds.add(id);
  if (typeof group.enabled !== 'boolean') {
    throw new Error(`分组「${id}」的 enabled 必须是布尔值。`);
  }
  if (!Array.isArray(group.rules)) {
    throw new Error(`分组「${id}」的 rules 必须是数组。`);
  }

  /** 已校验的组内规则。 */
  const rules = group.rules.map((rule, ruleIndex) => parseRule(rule, id, ruleIndex, ruleIds));
  /** 分组更新时间；v1 配置没有该字段，使用导出时间补齐。 */
  const updatedAt =
    typeof group.updatedAt === 'string' && !Number.isNaN(Date.parse(group.updatedAt))
      ? group.updatedAt
      : fallbackUpdatedAt;
  return {
    id,
    name: requireNonEmptyString(group.name, `分组「${id}」的名称`),
    enabled: group.enabled,
    updatedAt,
    rules,
  };
}

/**
 * 校验一条规则。
 * @param value 待校验规则
 * @param groupId 规则所属分组 ID
 * @param index 规则在组内的下标
 * @param ruleIds 已使用的规则 ID
 * @returns 已校验规则
 */
function parseRule(value: unknown, groupId: string, index: number, ruleIds: Set<string>): Rule {
  /** 当前规则对象。 */
  const rule = requireRecord(value, `分组「${groupId}」中的第 ${index + 1} 条规则`);
  /** 当前规则 ID。 */
  const id = requireNonEmptyString(rule.id, `分组「${groupId}」中第 ${index + 1} 条规则的 id`);
  if (ruleIds.has(id)) {
    throw new Error(`规则 ID ${id} 重复。`);
  }
  ruleIds.add(id);
  if (typeof rule.enabled !== 'boolean') {
    throw new Error(`规则「${id}」的 enabled 必须是布尔值。`);
  }
  if (!Object.values(MatchType).includes(rule.matchType as MatchType)) {
    throw new Error(`规则「${id}」的 matchType 不合法。`);
  }
  /** 所有规则共享的已校验字段。 */
  const base = {
    id,
    name: requireNonEmptyString(rule.name, `规则「${id}」的名称`),
    enabled: rule.enabled,
    matchType: rule.matchType as MatchType,
    pattern: requireNonEmptyString(rule.pattern, `规则「${id}」的匹配内容`),
  };
  if (base.matchType === MatchType.Regex) {
    try {
      new RegExp(base.pattern);
    } catch {
      throw new Error(`规则「${id}」的正则表达式语法错误。`);
    }
  }
  if (!Object.values(RuleType).includes(rule.type as RuleType)) {
    throw new Error(`规则「${id}」的 type 不合法。`);
  }

  switch (rule.type) {
    case RuleType.Block:
      return { ...base, type: RuleType.Block };
    case RuleType.Redirect:
      return {
        ...base,
        type: RuleType.Redirect,
        redirectUrl: requireNonEmptyString(rule.redirectUrl, `规则「${id}」的重定向地址`),
      };
    case RuleType.InjectParams:
      return { ...base, type: RuleType.InjectParams, params: parseStringRecord(rule.params, `规则「${id}」的 params`) };
    case RuleType.ModifyHeaders:
      return { ...base, type: RuleType.ModifyHeaders, headers: parseHeaderModifications(rule.headers, id) };
    case RuleType.MockResponse: {
      if (typeof rule.statusCode !== 'number' || !Number.isInteger(rule.statusCode) || rule.statusCode < 100 || rule.statusCode > 599) {
        throw new Error(`规则「${id}」的 statusCode 必须在 100 到 599 之间。`);
      }
      if (typeof rule.body !== 'string') {
        throw new Error(`规则「${id}」的 body 必须是字符串。`);
      }
      if (rule.delayMs !== undefined) {
        requireNonNegativeNumber(rule.delayMs, `规则「${id}」的 delayMs`);
      }
      /** 可选的响应头配置。 */
      const responseHeaders =
        rule.responseHeaders === undefined
          ? undefined
          : parseStringRecord(rule.responseHeaders, `规则「${id}」的 responseHeaders`);
      return {
        ...base,
        type: RuleType.MockResponse,
        statusCode: rule.statusCode,
        body: rule.body,
        ...(responseHeaders ? { responseHeaders } : {}),
        ...(rule.delayMs === undefined ? {} : { delayMs: rule.delayMs as number }),
      };
    }
    case RuleType.Delay:
      if (!Object.values(NetworkThrottlePreset).includes(rule.throttlePreset as NetworkThrottlePreset)) {
        throw new Error(`规则「${id}」的 throttlePreset 不合法。`);
      }
      return {
        ...base,
        type: RuleType.Delay,
        throttlePreset: rule.throttlePreset as NetworkThrottlePreset,
        latencyMs: requireNonNegativeNumber(rule.latencyMs, `规则「${id}」的 latencyMs`),
        downloadKbps: requireNonNegativeNumber(rule.downloadKbps, `规则「${id}」的 downloadKbps`),
        uploadKbps: requireNonNegativeNumber(rule.uploadKbps, `规则「${id}」的 uploadKbps`),
      };
    case RuleType.InsertScript:
      if (!Object.values(InsertScriptCodeType).includes(rule.codeType as InsertScriptCodeType)) {
        throw new Error(`规则「${id}」的 codeType 不合法。`);
      }
      if (!Object.values(InsertScriptTiming).includes(rule.timing as InsertScriptTiming)) {
        throw new Error(`规则「${id}」的 timing 不合法。`);
      }
      return {
        ...base,
        type: RuleType.InsertScript,
        codeType: rule.codeType as InsertScriptCodeType,
        timing: rule.timing as InsertScriptTiming,
        code: requireNonEmptyString(rule.code, `规则「${id}」的 code`),
      };
  }

  // 防御性兜底：即使未来新增枚举值但遗漏了上方分支，也绝不导入未知规则。
  throw new Error(`规则「${id}」的 type 不受支持。`);
}

/**
 * 校验 Header 修改项列表。
 * @param value 待校验的 Header 修改项
 * @param ruleId 所属规则 ID
 * @returns 已校验的 Header 修改项列表
 */
function parseHeaderModifications(value: unknown, ruleId: string): HeaderModification[] {
  if (!Array.isArray(value)) {
    throw new Error(`规则「${ruleId}」的 headers 必须是数组。`);
  }
  return value.map((item, index) => {
    /** 当前 Header 修改项。 */
    const header = requireRecord(item, `规则「${ruleId}」的第 ${index + 1} 个 Header 修改项`);
    if (!Object.values(HeaderTarget).includes(header.target as HeaderTarget)) {
      throw new Error(`规则「${ruleId}」第 ${index + 1} 个 Header 修改项的 target 不合法。`);
    }
    if (!Object.values(HeaderOperation).includes(header.operation as HeaderOperation)) {
      throw new Error(`规则「${ruleId}」第 ${index + 1} 个 Header 修改项的 operation 不合法。`);
    }
    if (header.value !== undefined && typeof header.value !== 'string') {
      throw new Error(`规则「${ruleId}」第 ${index + 1} 个 Header 修改项的 value 必须是字符串。`);
    }
    return {
      target: header.target as HeaderTarget,
      operation: header.operation as HeaderOperation,
      header: requireNonEmptyString(header.header, `规则「${ruleId}」第 ${index + 1} 个 Header 修改项的名称`),
      ...(header.value === undefined ? {} : { value: header.value }),
    };
  });
}
