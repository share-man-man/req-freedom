import type { RuleHit, RuleHitSummary } from '@req-freedom/shared';
import { RuleActionType } from '@req-freedom/shared';

/** 单个标签页最多保留的命中条数，超出后丢弃最早的记录。 */
const MAX_RULE_HITS_PER_TAB = 1000;

/**
 * 同时保留命中日志的标签页上限，超出后丢弃最久未更新的标签页。
 *
 * 单标签页的条数上限约束不了标签页数量，而 storage.session 的配额（约 10MB）是全局的：
 * 长时间开着大量标签页调试时镜像会逼近配额，写入失败只能静默降级。按经验的单标签页体量
 * 估算，这个上限对应数 MB 量级的镜像，留有充裕余量。
 */
export const MAX_TRACKED_TABS = 30;

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
 * 取出日志中最后一条命中的时间，用作该标签页的活跃度。
 *
 * 镜像不单独记录活跃度：最后一条命中的时间已经在日志里，冷启动据此还原淘汰顺序即可。
 * @param log 标签页命中日志
 * @returns 最后一条命中的时间；日志为空时为 0
 */
export function getLastHitAt(log: TabHitLog): number {
  return log.hits[log.hits.length - 1]?.at ?? 0;
}

/**
 * 取出命中日志中出现过的业务规则 ID。
 * @param hits 命中记录
 * @returns 按首次命中顺序去重后的规则 ID
 */
export function collectHitRuleIds(hits: readonly RuleHit[]): string[] {
  return [...new Set(hits.map((hit) => hit.ruleId))];
}

/**
 * 把命中日志投影成 popup 需要的摘要。
 * @param log 标签页命中日志
 * @returns 去重后的命中规则 ID 与截断标记
 */
export function summarizeHits(log: TabHitLog | undefined): RuleHitSummary {
  if (!log) {
    return { ruleIds: [], truncated: false };
  }
  return {
    ruleIds: collectHitRuleIds(log.hits),
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
 * 把镜像中恢复的日志并入内存，且不覆盖已存在或已被改动过的标签页。
 *
 * Service Worker 重启后「恢复」与「新请求写入」会竞争；只填充缺失的标签页即可避免
 * 恢复结果冲掉重启后已经记录的命中，无需额外的就绪门控。
 *
 * 「已存在」不足以覆盖清空：清空会把标签页从内存中移除，此时镜像读取可能已在途中，
 * 旧日志仍会被并回来。因此清空与丢弃必须额外把标签页登记进 skipTabIds。
 * @param current 内存中的权威日志
 * @param restored 从 storage.session 镜像读回的日志
 * @param skipTabIds 恢复完成前已被改动过的标签页，一律不从镜像回填
 */
export function mergeRestoredHits(
  current: Map<number, TabHitLog>,
  restored: Iterable<readonly [number, TabHitLog]>,
  skipTabIds: ReadonlySet<number> = new Set(),
): void {
  for (const [tabId, log] of restored) {
    if (!current.has(tabId) && !skipTabIds.has(tabId)) {
      current.set(tabId, log);
    }
  }
}
