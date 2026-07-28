import type { RuleHit, RuleHitSummary } from '@req-freedom/shared';
import { RuleActionType } from '@req-freedom/shared';

/** 单个标签页最多保留的命中条数，超出后丢弃最早的记录。 */
const MAX_RULE_HITS_PER_TAB = 1000;

/** 单条跨上下文消息最多接受的命中条数。 */
const MAX_HITS_PER_MESSAGE = 100;

/** 命中记录中业务规则 ID 的最大长度。 */
const MAX_RULE_ID_LENGTH = 256;

/** 命中记录中请求 URL 的最大长度。 */
const MAX_URL_LENGTH = 2048;

/** 命中记录中请求方法的最大长度。 */
const MAX_METHOD_LENGTH = 16;

/** 合法的业务动作类型集合，用于校验未受信任的上报。 */
const VALID_ACTION_TYPES = new Set<string>(Object.values(RuleActionType));

/** 单个标签页的命中日志。 */
export interface TabHitLog {
  /** 按记录顺序保存的命中。 */
  hits: RuleHit[];
  /** 是否已因超出上限丢弃过最早的记录。 */
  truncated: boolean;
}

/**
 * 创建空的标签页命中日志。
 * @returns 不含任何命中的新日志
 */
export function createTabHitLog(): TabHitLog {
  return { hits: [], truncated: false };
}

/**
 * 就地追加一批命中并维持容量上限。
 *
 * 刻意就地修改而非返回新数组：命中记录是逐请求写入的，复制整个数组会让单次页面加载
 * 的总开销退化为 O(n²)。
 * @param log 待追加的标签页日志
 * @param hits 本次产生的命中
 * @param max 日志容量上限
 * @returns 追加后的同一个日志对象
 */
export function appendHits(
  log: TabHitLog,
  hits: readonly RuleHit[],
  max: number = MAX_RULE_HITS_PER_TAB,
): TabHitLog {
  for (const hit of hits) {
    log.hits.push(hit);
  }
  if (log.hits.length > max) {
    log.hits.splice(0, log.hits.length - max);
    log.truncated = true;
  }
  return log;
}

/**
 * 把命中日志按业务规则归并成计数。
 * @param hits 命中记录
 * @returns 业务规则 ID 到命中数量的映射
 */
export function countByRule(hits: readonly RuleHit[]): Record<string, number> {
  /** 按业务规则累计的命中数量。 */
  const counts: Record<string, number> = {};
  for (const hit of hits) {
    counts[hit.ruleId] = (counts[hit.ruleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * 把命中日志投影成 popup 需要的摘要。
 * @param log 标签页命中日志
 * @returns 总数、逐规则计数与截断标记
 */
export function summarizeHits(log: TabHitLog | undefined): RuleHitSummary {
  if (!log) {
    return { total: 0, byRule: {}, truncated: false };
  }
  return {
    total: log.hits.length,
    byRule: countByRule(log.hits),
    truncated: log.truncated,
  };
}

/**
 * 校验来自页面上下文的命中上报。
 *
 * MAIN world 与宿主页共享执行环境，上报内容一律视为不可信输入。
 * @param value 未受信任的消息字段
 * @returns 字段合法且数量受限的命中记录
 */
export function parseHits(value: unknown): RuleHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_HITS_PER_MESSAGE).flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    /** 待校验的命中字段。 */
    const { ruleId, action, url, method, at } = item as Record<string, unknown>;
    if (
      typeof ruleId !== 'string' ||
      ruleId.length === 0 ||
      ruleId.length > MAX_RULE_ID_LENGTH ||
      typeof action !== 'string' ||
      !VALID_ACTION_TYPES.has(action) ||
      typeof url !== 'string' ||
      url.length > MAX_URL_LENGTH ||
      typeof method !== 'string' ||
      method.length > MAX_METHOD_LENGTH ||
      !Number.isFinite(at)
    ) {
      return [];
    }
    return [{ ruleId, action: action as RuleActionType, url, method, at: Number(at) }];
  });
}

/**
 * 把镜像中恢复的日志并入内存，且不覆盖已存在的标签页。
 *
 * Service Worker 重启后「恢复」与「新请求写入」会竞争；只填充缺失的标签页即可避免
 * 恢复结果冲掉重启后已经记录的命中，无需额外的就绪门控。
 * @param current 内存中的权威日志
 * @param restored 从 storage.session 镜像读回的日志
 */
export function mergeRestoredHits(
  current: Map<number, TabHitLog>,
  restored: Iterable<readonly [number, TabHitLog]>,
): void {
  for (const [tabId, log] of restored) {
    if (!current.has(tabId)) {
      current.set(tabId, log);
    }
  }
}
