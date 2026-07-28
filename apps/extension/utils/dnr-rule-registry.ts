import { DNR_RULE_ID_OFFSET } from '@req-freedom/shared';
import { allocateStableDnrRuleId } from './dnr-rule-id';

/** DNR 动作身份注册表当前结构版本。 */
const DNR_RULE_ID_REGISTRY_VERSION = 1;

/** Chrome DNR 数字规则 ID 上限。 */
const DNR_RULE_ID_MAX = 2_147_483_647;

/** 单个注册表动作键允许的最大长度。 */
const MAX_DNR_ACTION_KEY_LENGTH = 1_024;

/** 一个可持久化的 DNR 动作身份。 */
interface DnrRuleIdRegistryEntry {
  /** 分配后永不复用的 DNR 数字 ID。 */
  dnrRuleId: number;
  /** 用于 popup 归并角标的业务规则 ID。 */
  ruleId: string;
}

/** 持久化在 storage.local 中的 DNR 动作身份注册表。 */
export interface DnrRuleIdRegistry {
  /** 注册表结构版本。 */
  version: number;
  /** 稳定业务动作键到数字 ID 与业务规则的映射。 */
  entries: Record<string, DnrRuleIdRegistryEntry>;
}

/** 当前规则目录中一个待注册的 DNR 动作身份。 */
export interface DnrRuleIdentityDescriptor {
  /** 不受不同类型动作排序影响的稳定业务动作键。 */
  actionKey: string;
  /** 用于首次分配时兼容旧版数字 ID 的哈希键。 */
  legacyKey: string;
  /** 业务规则 ID。 */
  ruleId: string;
}

/** 确保注册表动作身份后的结果。 */
export interface EnsuredDnrRuleIdRegistry {
  /** 补齐后的持久化注册表。 */
  registry: DnrRuleIdRegistry;
  /** 本轮是否产生需要写回 storage.local 的变化。 */
  changed: boolean;
}

/**
 * 创建空的 DNR 动作身份注册表。
 * @returns 当前版本的空注册表
 */
export function createEmptyDnrRuleIdRegistry(): DnrRuleIdRegistry {
  return { version: DNR_RULE_ID_REGISTRY_VERSION, entries: {} };
}

/**
 * 校验持久化的 DNR 动作身份注册表。
 *
 * 已删除规则的 entry 会作为 tombstone 保留，保证当前浏览器会话内的历史 DNR 明细
 * 不会因数字 ID 被复用而误映射。
 * @param value storage.local 中的未知值
 * @returns 字段合法、数字 ID 唯一的注册表
 */
export function parseDnrRuleIdRegistry(value: unknown): DnrRuleIdRegistry {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== DNR_RULE_ID_REGISTRY_VERSION ||
    typeof (value as { entries?: unknown }).entries !== 'object' ||
    (value as { entries?: unknown }).entries === null
  ) {
    return createEmptyDnrRuleIdRegistry();
  }
  /** 已确认唯一的 DNR 数字 ID。 */
  const usedIds = new Set<number>();
  /** 校验后的注册表 entries。 */
  const entries: Record<string, DnrRuleIdRegistryEntry> = {};
  for (const [actionKey, rawEntry] of Object.entries(
    (value as { entries: Record<string, unknown> }).entries,
  )) {
    if (
      actionKey.length === 0 ||
      actionKey.length > MAX_DNR_ACTION_KEY_LENGTH ||
      typeof rawEntry !== 'object' ||
      rawEntry === null
    ) {
      continue;
    }
    /** 未受信任 entry 中的 DNR 数字 ID。 */
    const dnrRuleId = Number((rawEntry as { dnrRuleId?: unknown }).dnrRuleId);
    /** 未受信任 entry 中的业务规则 ID。 */
    const ruleId = (rawEntry as { ruleId?: unknown }).ruleId;
    if (
      !Number.isInteger(dnrRuleId) ||
      dnrRuleId < DNR_RULE_ID_OFFSET ||
      dnrRuleId > DNR_RULE_ID_MAX ||
      usedIds.has(dnrRuleId) ||
      typeof ruleId !== 'string' ||
      ruleId.length === 0
    ) {
      continue;
    }
    usedIds.add(dnrRuleId);
    entries[actionKey] = { dnrRuleId, ruleId };
  }
  return { version: DNR_RULE_ID_REGISTRY_VERSION, entries };
}

/**
 * 为规则目录中的全部 DNR 动作补齐持久化数字 ID。
 * @param current 当前持久化注册表
 * @param descriptors 当前规则目录中的 DNR 动作身份
 * @returns 补齐后的注册表及变更标记
 */
export function ensureDnrRuleIdRegistry(
  current: DnrRuleIdRegistry,
  descriptors: readonly DnrRuleIdentityDescriptor[],
): EnsuredDnrRuleIdRegistry {
  /** 可安全修改的新注册表 entries。 */
  const entries = { ...current.entries };
  /** 历史和当前动作已经占用的全部数字 ID。 */
  const usedIds = new Set(
    Object.values(entries).map((entry) => entry.dnrRuleId),
  );
  /** 本轮注册表是否发生变化。 */
  let changed = current.version !== DNR_RULE_ID_REGISTRY_VERSION;
  /** 按稳定键排序的新动作，避免输入顺序影响首次冲突分配。 */
  const sortedDescriptors = [...descriptors].sort((left, right) => {
    if (left.actionKey === right.actionKey) {
      return 0;
    }
    return left.actionKey < right.actionKey ? -1 : 1;
  });
  for (const descriptor of sortedDescriptors) {
    /** 当前动作已经存在的持久化身份。 */
    const existing = entries[descriptor.actionKey];
    if (existing) {
      if (existing.ruleId !== descriptor.ruleId) {
        entries[descriptor.actionKey] = { ...existing, ruleId: descriptor.ruleId };
        changed = true;
      }
      continue;
    }
    entries[descriptor.actionKey] = {
      dnrRuleId: allocateStableDnrRuleId(descriptor.legacyKey, usedIds),
      ruleId: descriptor.ruleId,
    };
    changed = true;
  }
  return {
    registry: { version: DNR_RULE_ID_REGISTRY_VERSION, entries },
    changed,
  };
}

/**
 * 构造 DNR 数字 ID 到业务规则 ID 的全局只读映射。
 * @param registry 持久化动作身份注册表
 * @returns 同时覆盖当前动作与历史 tombstone 的映射
 */
export function createDnrRuleIdLookup(
  registry: DnrRuleIdRegistry,
): Map<number, string> {
  return new Map(
    Object.values(registry.entries).map((entry) => [entry.dnrRuleId, entry.ruleId]),
  );
}
