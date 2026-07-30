import type { RuleHit, RuleHitSummary } from '@req-freedom/shared';
import {
  RuleActionType,
  RuleHitOutcome,
  RuleHitSkipReason,
  STORAGE_KEY_RULE_HITS,
} from '@req-freedom/shared';

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

/** 合法的执行结果集合，用于校验未受信任的上报。 */
const VALID_OUTCOMES = new Set<string>(Object.values(RuleHitOutcome));

/** 合法的跳过原因集合，用于校验未受信任的上报。 */
const VALID_SKIP_REASONS = new Set<string>(Object.values(RuleHitSkipReason));

/**
 * 返回单个标签页镜像使用的 storage.session 键。
 *
 * 写入方（background 的命中存储）与读取方（popup 的实时刷新）都要用它，因此放在这个不依赖
 * 浏览器 API 的模块里，避免两处各拼一次键名。
 * @param tabId 标签页 ID
 * @returns 该标签页的镜像键
 */
export function getRuleHitsMirrorKey(tabId: number): string {
  return `${STORAGE_KEY_RULE_HITS}:${tabId}`;
}

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
 * 构造一条「已执行」的命中记录。
 *
 * 两条通道的执行处都要生成这种记录，字面量各写一份容易漏字段（`outcome` 就是后加的），
 * 因此统一由此构造。
 * @param ruleId 业务规则 ID
 * @param action 实际执行的动作类型
 * @param request 触发命中的请求上下文
 * @returns 标记为已执行的命中记录
 */
export function createAppliedHit(
  ruleId: string,
  action: RuleActionType,
  request: { url: string; method: string; at: number },
): RuleHit {
  return { ruleId, action, ...request, outcome: RuleHitOutcome.Applied };
}

/**
 * 判断日志中是否存在实际生效过的命中。
 *
 * 「有记录」不等于「有规则生效」：匹配上却未能应用的记录同样留在日志里供界面解释原因，
 * 但它们不该点亮徽标。
 * @param log 标签页命中日志
 * @returns 存在至少一条已执行的命中时为 true
 */
export function hasAppliedHit(log: TabHitLog | undefined): boolean {
  return log?.hits.some((hit) => hit.outcome === RuleHitOutcome.Applied) ?? false;
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
 * 取出命中日志中实际生效过的业务规则 ID。
 * @param hits 命中记录
 * @returns 按首次命中顺序去重后的规则 ID
 */
export function collectHitRuleIds(hits: readonly RuleHit[]): string[] {
  return [
    ...new Set(
      hits
        .filter((hit) => hit.outcome === RuleHitOutcome.Applied)
        .map((hit) => hit.ruleId),
    ),
  ];
}

/**
 * 把命中日志投影成 popup 需要的摘要。
 *
 * 「生效过」优先于「匹配上但未应用」：同一规则两种记录都有时只算前者——界面上一条规则
 * 只有一个状态位，而「它确实生效过」是更重要的事实。
 * @param log 标签页命中日志
 * @returns 生效规则、未能应用的规则及其原因、截断标记
 */
export function summarizeHits(log: TabHitLog | undefined): RuleHitSummary {
  if (!log) {
    return { ruleIds: [], skippedRuleIds: {}, truncated: false };
  }
  /** 本页实际生效过的规则。 */
  const ruleIds = collectHitRuleIds(log.hits);
  /** 生效过的规则集合，用于把它们从「未应用」里排除。 */
  const appliedRuleIds = new Set(ruleIds);
  /** 匹配上却一次都没应用的规则及其首次原因。 */
  const skippedRuleIds: Record<string, RuleHitSkipReason> = {};
  for (const hit of log.hits) {
    if (
      hit.outcome !== RuleHitOutcome.Skipped ||
      appliedRuleIds.has(hit.ruleId) ||
      hit.ruleId in skippedRuleIds
    ) {
      continue;
    }
    skippedRuleIds[hit.ruleId] = hit.reason;
  }
  return { ruleIds, skippedRuleIds, truncated: log.truncated };
}

/**
 * 校验来自页面上下文的命中上报。
 *
 * MAIN world 与宿主页共享执行环境，上报内容一律视为不可信输入。
 *
 * 记录时间由接收方给出，上报里的 `at` 一律丢弃：它参与标签页淘汰的活跃度排序，宿主页
 * 报一个远期时间就能把自己的日志钉住、把其他标签页挤出预算。页面执行与接收之间只隔一次
 * 消息投递，用接收时间不损失精度。
 * @param value 未受信任的消息字段
 * @param at 接收方的记录时间
 * @returns 字段合法且数量受限的命中记录
 */
export function parseHits(value: unknown, at: number): RuleHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_HITS_PER_MESSAGE).flatMap((item): RuleHit[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    /** 待校验的命中字段；上报的 `at` 不参与校验，记录时间以接收方为准。 */
    const { ruleId, action, url, method, outcome, reason } = item as Record<string, unknown>;
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
      typeof outcome !== 'string' ||
      !VALID_OUTCOMES.has(outcome)
    ) {
      return [];
    }
    /** 命中记录的公共字段。 */
    const base = { ruleId, action: action as RuleActionType, url, method, at };
    if (outcome === RuleHitOutcome.Applied) {
      return [{ ...base, outcome: RuleHitOutcome.Applied }];
    }
    // 跳过必须带上合法原因，否则界面无从解释，整条丢弃
    if (typeof reason !== 'string' || !VALID_SKIP_REASONS.has(reason)) {
      return [];
    }
    return [{ ...base, outcome: RuleHitOutcome.Skipped, reason: reason as RuleHitSkipReason }];
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
