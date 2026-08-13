import { browser } from 'wxt/browser';
import type {
  DnrRegistrationIssues,
  RuleGroup,
  RuleHighlightRequest,
  RuleHitLog,
  RuleHitSummary,
} from '@req-freedom/shared';
import { getRuleHitsMirrorKey, summarizeHits, type TabHitLog } from './rule-hit';
import {
  STORAGE_KEY_DNR_ISSUES,
  STORAGE_KEY_ENABLED,
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_PENDING_RULE_HIGHLIGHT,
  STORAGE_KEY_RULE_HITS,
} from '@req-freedom/shared';

/**
 * 校验 storage 中的一次性规则定位请求。
 * @param value storage 中的原始值
 * @returns 合法请求；格式不符时返回 null
 */
function parsePendingRuleHighlight(value: unknown): RuleHighlightRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  /** 便于逐字段校验的原始记录。 */
  const request = value as Record<string, unknown>;
  if (typeof request.ruleId !== 'string' || typeof request.requestId !== 'string') {
    return null;
  }
  return { ruleId: request.ruleId, requestId: request.requestId };
}

/**
 * 读取全部规则分组
 * @returns 分组列表，未初始化时返回空数组
 */
export async function getGroups(): Promise<RuleGroup[]> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_GROUPS);
  /** storage 中保存的原始分组列表。 */
  const storedGroups = (result[STORAGE_KEY_GROUPS] as RuleGroup[] | undefined) ?? [];
  return storedGroups;
}

/**
 * 保存全部规则分组（整体覆盖）
 * @param groups 分组列表
 */
export async function saveGroups(groups: RuleGroup[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_GROUPS]: groups });
}

/**
 * 订阅规则分组的变化。
 *
 * popup 与 options 是两个独立的页面上下文，一方写入 storage 后另一方不会自动重渲染；
 * 长驻的 options 页面靠这里跟随 popup 的启停改动，而不是只在挂载时读一次。
 * @param onChange 分组变化时的回调；分组被清空时收到空数组
 * @returns 取消订阅的函数
 */
export function watchGroups(onChange: (groups: RuleGroup[]) => void): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'local' || !(STORAGE_KEY_GROUPS in changes)) {
      return;
    }
    onChange((changes[STORAGE_KEY_GROUPS]?.newValue as RuleGroup[] | undefined) ?? []);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * 读取全局开关状态
 * @returns 是否启用，默认 true
 */
export async function getEnabled(): Promise<boolean> {
  /** storage 查询结果 */
  const result = await browser.storage.local.get(STORAGE_KEY_ENABLED);
  return (result[STORAGE_KEY_ENABLED] as boolean | undefined) ?? true;
}

/**
 * 写入全局开关状态
 * @param enabled 是否启用
 */
export async function setEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_ENABLED]: enabled });
}

/**
 * 订阅全局开关状态的变化。
 *
 * 与 watchGroups 同理：popup 与 options 各自持有一份状态，长驻的管理页靠这里跟随
 * popup 的全局启停，导入配置整体覆盖时也会走到这里。
 * @param onChange 开关变化时的回调；被清除时回落到默认的启用态
 * @returns 取消订阅的函数
 */
export function watchEnabled(onChange: (enabled: boolean) => void): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'local' || !(STORAGE_KEY_ENABLED in changes)) {
      return;
    }
    onChange((changes[STORAGE_KEY_ENABLED]?.newValue as boolean | undefined) ?? true);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * 以一次 storage 写入替换全部可持久化配置，供导入流程使用。
 * @param groups 要替换的规则分组
 * @param enabled 要替换的全局开关状态
 */
export async function saveConfiguration(groups: RuleGroup[], enabled: boolean): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY_GROUPS]: groups,
    [STORAGE_KEY_ENABLED]: enabled,
  });
}

/**
 * 写入一次性的 options 页面规则定位请求。
 *
 * 先写 session 再调用 openOptionsPage：已打开的页面会通过监听即时接收，新页面则在挂载后读取。
 * @param ruleId 要定位的业务规则 ID
 */
export async function setPendingRuleHighlight(ruleId: string): Promise<void> {
  /** 每次写入都不同的请求，避免重复点击同一规则时浏览器省略变更事件。 */
  const request: RuleHighlightRequest = { ruleId, requestId: crypto.randomUUID() };
  await browser.storage.session.set({ [STORAGE_KEY_PENDING_RULE_HIGHLIGHT]: request });
}

/**
 * 读取并清除尚未处理的 options 页面规则定位请求。
 * @returns 待定位的业务规则 ID；没有合法请求时返回 null
 */
export async function takePendingRuleHighlight(): Promise<string | null> {
  /** storage 查询结果。 */
  const result = await browser.storage.session.get(STORAGE_KEY_PENDING_RULE_HIGHLIGHT);
  /** 格式校验后的待处理请求。 */
  const request = parsePendingRuleHighlight(result[STORAGE_KEY_PENDING_RULE_HIGHLIGHT]);
  if (!request) {
    return null;
  }
  await browser.storage.session.remove(STORAGE_KEY_PENDING_RULE_HIGHLIGHT);
  return request.ruleId;
}

/**
 * 订阅 options 页面运行期间收到的规则定位请求。
 * @param onHighlight 收到合法请求时的回调
 * @returns 取消订阅的函数
 */
export function watchPendingRuleHighlight(onHighlight: (ruleId: string) => void): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'session' || !(STORAGE_KEY_PENDING_RULE_HIGHLIGHT in changes)) {
      return;
    }
    /** 格式校验后的新定位请求。 */
    const request = parsePendingRuleHighlight(
      changes[STORAGE_KEY_PENDING_RULE_HIGHLIGHT]?.newValue,
    );
    if (!request) {
      return;
    }
    onHighlight(request.ruleId);
    void browser.storage.session.remove(STORAGE_KEY_PENDING_RULE_HIGHLIGHT);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * 读取 DNR 注册失败记录。
 *
 * 记录由 background 每轮规则同步后写入 storage.session；Service Worker 尚未完成首次同步时
 * 读到空对象，界面据此不显示任何失败提示。
 * @returns 按业务规则 ID 索引的注册失败记录，无失败时为空对象
 */
export async function getDnrIssues(): Promise<DnrRegistrationIssues> {
  /** storage 查询结果 */
  const result = await browser.storage.session.get(STORAGE_KEY_DNR_ISSUES);
  return (result[STORAGE_KEY_DNR_ISSUES] as DnrRegistrationIssues | undefined) ?? {};
}

/**
 * 订阅 DNR 注册失败记录的变化。
 *
 * 规则改动后 background 会重新同步并覆盖该记录，界面借此即时反映最新结果，无需轮询。
 * @param onChange 记录变化时的回调
 * @returns 取消订阅的函数
 */
export function watchDnrIssues(
  onChange: (issues: DnrRegistrationIssues) => void,
): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'session' || !(STORAGE_KEY_DNR_ISSUES in changes)) {
      return;
    }
    onChange((changes[STORAGE_KEY_DNR_ISSUES]?.newValue as DnrRegistrationIssues | undefined) ?? {});
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * 订阅某个标签页命中摘要的变化。
 *
 * 直接读 background 写往 storage.session 的命中镜像，而不是轮询或让 background 逐条推送：
 * 镜像本就带 1 秒防抖，天然是合适的刷新节奏，且不会为了刷新界面额外唤醒 Service Worker。
 * 代价是最多滞后一个防抖窗口，对实时查看命中而言可以接受。
 * @param tabId 目标标签页
 * @param onChange 摘要变化时的回调
 * @returns 取消订阅的函数
 */
export function watchTabHitSummary(
  tabId: number,
  onChange: (summary: RuleHitSummary) => void,
): () => void {
  return watchTabHitMirror(tabId, (log) => onChange(summarizeHits(log)));
}

/**
 * 订阅某个标签页完整命中日志的变化。
 *
 * 与 watchTabHitSummary 同源，只是不做摘要投影：请求日志视图要逐条展示命中，
 * 需要镜像里的原始记录。
 * @param tabId 目标标签页
 * @param onChange 日志变化时的回调；日志被清空时收到空日志
 * @returns 取消订阅的函数
 */
export function watchTabHitLog(
  tabId: number,
  onChange: (log: RuleHitLog) => void,
): () => void {
  return watchTabHitMirror(tabId, (log) => onChange(log ?? { hits: [], truncated: false }));
}

/**
 * 订阅任意标签页命中镜像的写入，用于刷新「有日志的标签页」列表。
 *
 * 只通知发生了变化，不携带内容：列表本身要向 background 重新查询内存中的权威数据，
 * 镜像在这里只当作「有新命中了」的信号。
 * @param onChange 任一标签页镜像发生变化时的回调
 * @returns 取消订阅的函数
 */
export function watchHitTabsChanged(onChange: () => void): () => void {
  /** storage 变更监听器。 */
  const listener = (changes: Record<string, unknown>, area: string): void => {
    if (area !== 'session') {
      return;
    }
    if (Object.keys(changes).some((key) => key.startsWith(`${STORAGE_KEY_RULE_HITS}:`))) {
      onChange();
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * 订阅某个标签页命中镜像的原始变化。
 *
 * 直接读 background 写往 storage.session 的命中镜像，而不是轮询或让 background 逐条推送：
 * 镜像本就带 1 秒防抖，天然是合适的刷新节奏，且不会为了刷新界面额外唤醒 Service Worker。
 * 代价是最多滞后一个防抖窗口，对实时查看命中而言可以接受。
 * @param tabId 目标标签页
 * @param onChange 镜像变化时的回调；日志被清空或标签页关闭时收到 undefined
 * @returns 取消订阅的函数
 */
function watchTabHitMirror(
  tabId: number,
  onChange: (log: TabHitLog | undefined) => void,
): () => void {
  /** 该标签页命中镜像的存储键。 */
  const mirrorKey = getRuleHitsMirrorKey(tabId);
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'session' || !(mirrorKey in changes)) {
      return;
    }
    // 日志被清空或标签页关闭时镜像键会被删除，此时 newValue 为 undefined
    onChange(changes[mirrorKey]?.newValue as TabHitLog | undefined);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
