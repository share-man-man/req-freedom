import { browser } from 'wxt/browser';
import {
  CONFIGURATION_HISTORY_LOCK_NAME,
  MAX_CONFIGURATION_HISTORY_BYTES,
  MAX_CONFIGURATION_HISTORY_ENTRIES,
  STORAGE_KEY_CONFIGURATION_HISTORY,
  type RuleGroup,
} from '@req-freedom/shared';
import { getEnabled, getGroups, saveConfiguration } from './storage';

/** 一次可恢复的完整规则配置快照。 */
export interface ConfigurationSnapshot {
  /** 全局规则开关。 */
  enabled: boolean;
  /** 全部规则分组。 */
  groups: RuleGroup[];
}

/** 时间线中的单个配置节点。 */
interface ConfigurationHistoryEntry {
  /** 节点对应的完整配置。 */
  snapshot: ConfigurationSnapshot;
  /** 产生该节点的用户操作名称；初始节点没有操作名称。 */
  label: string | null;
  /** 节点创建时间。 */
  createdAt: string;
}

/** 线性配置历史：entries 保存时间线，cursor 指向当前生效节点。 */
export interface ConfigurationHistory {
  /** 按时间顺序排列的配置节点。 */
  entries: ConfigurationHistoryEntry[];
  /** 当前生效节点在 entries 中的下标。 */
  cursor: number;
}

/** 供界面渲染撤销 / 重做按钮的精简状态。 */
export interface ConfigurationHistoryStatus {
  /** 当前是否可以撤销。 */
  canUndo: boolean;
  /** 当前是否可以重做。 */
  canRedo: boolean;
  /** 撤销将回退的操作名称。 */
  undoLabel: string | null;
  /** 重做将恢复的操作名称。 */
  redoLabel: string | null;
}

/** 空历史对应的界面状态。 */
export const EMPTY_CONFIGURATION_HISTORY_STATUS: ConfigurationHistoryStatus = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
};

/**
 * 通过浏览器 Web Locks 串行执行跨扩展页面的历史读改写事务。
 * @param operation 要在独占锁内执行的异步操作
 * @returns 操作结果
 */
function runConfigurationHistoryTransaction<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  return navigator.locks
    .request(CONFIGURATION_HISTORY_LOCK_NAME, operation)
    .then((result) => result);
}

/**
 * 深拷贝配置快照，避免历史节点被后续 React 状态修改污染。
 * @param snapshot 要复制的配置
 * @returns 与输入内容相同、引用隔离的配置
 */
function cloneSnapshot(snapshot: ConfigurationSnapshot): ConfigurationSnapshot {
  return structuredClone(snapshot);
}

/**
 * 判断两个配置快照内容是否一致。
 * @param left 左侧配置
 * @param right 右侧配置
 * @returns 内容是否一致
 */
function configurationSnapshotsEqual(
  left: ConfigurationSnapshot,
  right: ConfigurationSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 从当前配置创建只有一个初始节点的历史。
 * @param snapshot 当前配置
 * @param createdAt 初始节点时间
 * @returns 新历史
 */
export function createConfigurationHistory(
  snapshot: ConfigurationSnapshot,
  createdAt = new Date().toISOString(),
): ConfigurationHistory {
  return {
    entries: [{ snapshot: cloneSnapshot(snapshot), label: null, createdAt }],
    cursor: 0,
  };
}

/**
 * 将一次新配置提交追加到历史，并裁掉 cursor 之后已经失效的重做分支。
 * @param history 当前历史
 * @param snapshot 新配置
 * @param label 用户操作名称
 * @param createdAt 新节点时间
 * @returns 追加后的历史；配置未变化时原样返回
 */
export function appendConfigurationHistory(
  history: ConfigurationHistory,
  snapshot: ConfigurationSnapshot,
  label: string,
  createdAt = new Date().toISOString(),
): ConfigurationHistory {
  /** 当前生效的历史节点。 */
  const currentEntry = history.entries[history.cursor];
  if (currentEntry && configurationSnapshotsEqual(currentEntry.snapshot, snapshot)) {
    return history;
  }
  /** 撤销后再修改时只保留 cursor 及其之前的有效时间线。 */
  const retainedEntries = history.entries.slice(0, history.cursor + 1);
  /** 追加了新配置节点的完整时间线。 */
  const appendedEntries = [
    ...retainedEntries,
    { snapshot: cloneSnapshot(snapshot), label, createdAt },
  ];
  /** 超出上限后丢弃最早节点，防止 session 存储无界增长。 */
  const boundedEntries = appendedEntries.slice(-MAX_CONFIGURATION_HISTORY_ENTRIES);
  return { entries: boundedEntries, cursor: boundedEntries.length - 1 };
}

/**
 * 把历史游标移动一步。
 * @param history 当前历史
 * @param direction -1 表示撤销，1 表示重做
 * @returns 移动后的历史；无法继续移动时返回 null
 */
export function moveConfigurationHistory(
  history: ConfigurationHistory,
  direction: -1 | 1,
): ConfigurationHistory | null {
  /** 移动后的目标游标。 */
  const nextCursor = history.cursor + direction;
  if (nextCursor < 0 || nextCursor >= history.entries.length) {
    return null;
  }
  return { ...history, cursor: nextCursor };
}

/**
 * 从历史计算界面按钮状态和操作名称。
 * @param history 当前历史
 * @returns 精简历史状态
 */
export function getConfigurationHistoryStatus(
  history: ConfigurationHistory,
): ConfigurationHistoryStatus {
  /** 当前节点；其 label 就是撤销当前变更时应展示的名称。 */
  const currentEntry = history.entries[history.cursor];
  /** 当前节点之后的节点；其 label 就是重做时应展示的名称。 */
  const nextEntry = history.entries[history.cursor + 1];
  return {
    canUndo: history.cursor > 0,
    canRedo: history.cursor < history.entries.length - 1,
    undoLabel: history.cursor > 0 ? currentEntry?.label ?? null : null,
    redoLabel: nextEntry?.label ?? null,
  };
}

/**
 * 估算历史写入 session storage 时占用的字节数。
 * @param history 待估算的历史
 * @returns 序列化后的字节数（含键名开销）
 */
function measureConfigurationHistoryBytes(history: ConfigurationHistory): number {
  return (
    new TextEncoder().encode(JSON.stringify(history)).length +
    STORAGE_KEY_CONFIGURATION_HISTORY.length
  );
}

/**
 * 按字节预算裁剪历史，防止大体积配置快照撑爆 session 配额。
 *
 * 每次丢弃离当前节点更远的一端：重做分支不短于撤销分支时先丢最新节点，否则丢最早节点，
 * 保证当前生效节点始终保留。
 * @param history 待裁剪的历史
 * @param maxBytes 允许占用的字节上限
 * @returns 预算内的历史；仅剩当前节点仍超预算时返回 null
 */
export function trimConfigurationHistoryToBudget(
  history: ConfigurationHistory,
  maxBytes: number = MAX_CONFIGURATION_HISTORY_BYTES,
): ConfigurationHistory | null {
  /** 逐步裁剪中的历史。 */
  let trimmed = history;
  while (measureConfigurationHistoryBytes(trimmed) > maxBytes) {
    if (trimmed.entries.length <= 1) {
      return null;
    }
    /** 当前节点之后可重做的节点数量。 */
    const redoCount = trimmed.entries.length - 1 - trimmed.cursor;
    /** 当前节点之前可撤销的节点数量。 */
    const undoCount = trimmed.cursor;
    trimmed =
      redoCount > 0 && redoCount >= undoCount
        ? { entries: trimmed.entries.slice(0, -1), cursor: trimmed.cursor }
        : { entries: trimmed.entries.slice(1), cursor: trimmed.cursor - 1 };
  }
  return trimmed;
}

/**
 * 只保留当前生效节点的历史，用于写入配额不足时的降级。
 * @param history 当前历史
 * @returns 单节点历史
 */
function keepCurrentEntryOnly(history: ConfigurationHistory): ConfigurationHistory {
  return { entries: [history.entries[history.cursor]], cursor: 0 };
}

/**
 * 校验 storage 中读出的历史基本结构。
 * @param value storage 原始值
 * @returns 是否为可使用的配置历史
 */
function isConfigurationHistory(value: unknown): value is ConfigurationHistory {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  /** 便于校验顶层字段的原始记录。 */
  const history = value as Record<string, unknown>;
  if (!Array.isArray(history.entries) || typeof history.cursor !== 'number') {
    return false;
  }
  return (
    Number.isInteger(history.cursor) &&
    history.cursor >= 0 &&
    history.cursor < history.entries.length
  );
}

/**
 * 读取 session 中的配置历史。
 * @returns 合法历史；尚未初始化或内容损坏时返回 null
 */
async function getConfigurationHistory(): Promise<ConfigurationHistory | null> {
  /** storage 查询结果。 */
  const result = await browser.storage.session.get(STORAGE_KEY_CONFIGURATION_HISTORY);
  /** storage 中保存的未知历史值。 */
  const storedHistory = result[STORAGE_KEY_CONFIGURATION_HISTORY];
  return isConfigurationHistory(storedHistory) ? storedHistory : null;
}

/**
 * 丢弃 session 中的配置历史，等价于本次会话暂时不提供撤销 / 重做。
 */
async function clearConfigurationHistory(): Promise<void> {
  try {
    await browser.storage.session.remove(STORAGE_KEY_CONFIGURATION_HISTORY);
  } catch {
    // session 已不可写时无需处理：历史本就是尽力而为的会话级能力。
  }
}

/**
 * 尽力保存配置历史：先按字节预算裁剪，写入仍失败时逐级降级。
 *
 * session 配额由命中日志等数据共享，无法在本地精确预测，因此必须捕获写入异常，
 * 否则配额超限会以未处理的 Promise 异常暴露给用户。
 * @param history 要写入 session 的历史
 * @returns 实际写入的历史；完全无法保存时返回 null
 */
async function saveConfigurationHistory(
  history: ConfigurationHistory,
): Promise<ConfigurationHistory | null> {
  /** 裁剪到字节预算内的历史。 */
  const bounded = trimConfigurationHistoryToBudget(history);
  if (bounded) {
    try {
      await browser.storage.session.set({ [STORAGE_KEY_CONFIGURATION_HISTORY]: bounded });
      return bounded;
    } catch {
      // 预算内仍写入失败说明其他会话数据占满配额，继续降级。
    }
    if (bounded.entries.length > 1) {
      /** 只保留当前节点的最小历史。 */
      const currentOnly = keepCurrentEntryOnly(bounded);
      try {
        await browser.storage.session.set({
          [STORAGE_KEY_CONFIGURATION_HISTORY]: currentOnly,
        });
        return currentOnly;
      } catch {
        // 单节点也放不下，只能彻底放弃本次历史。
      }
    }
  }
  await clearConfigurationHistory();
  return null;
}

/**
 * 读取当前真正生效的完整配置。
 * @returns local storage 中的配置快照
 */
async function getCurrentConfiguration(): Promise<ConfigurationSnapshot> {
  /** 并行读取的全局开关和规则分组。 */
  const [enabled, groups] = await Promise.all([getEnabled(), getGroups()]);
  return { enabled, groups };
}

/**
 * 让历史当前节点与 local storage 当前配置对齐。
 *
 * 若检测到未经过历史仓库的外部写入，安全起见从该配置重新开始时间线，避免撤销覆盖未知变更。
 * @param history 已读取的历史
 * @param current 当前生效配置
 * @returns 可继续提交的对齐历史
 */
function alignConfigurationHistory(
  history: ConfigurationHistory | null,
  current: ConfigurationSnapshot,
): ConfigurationHistory {
  /** 历史游标指向的节点。 */
  const currentEntry = history?.entries[history.cursor];
  return currentEntry && configurationSnapshotsEqual(currentEntry.snapshot, current)
    ? history
    : createConfigurationHistory(current);
}

/**
 * 用 local storage 当前配置初始化或校正 session 历史。
 * @returns 初始化后的界面历史状态
 */
export async function initializeConfigurationHistory(): Promise<ConfigurationHistoryStatus> {
  return runConfigurationHistoryTransaction(async () => {
    /** 当前生效配置。 */
    const current = await getCurrentConfiguration();
    /** 与当前配置对齐后的历史。 */
    const history = alignConfigurationHistory(await getConfigurationHistory(), current);
    /** 实际写入 session 的历史。 */
    const storedHistory = await saveConfigurationHistory(history);
    return storedHistory
      ? getConfigurationHistoryStatus(storedHistory)
      : EMPTY_CONFIGURATION_HISTORY_STATUS;
  });
}

/**
 * 提交一份新配置，同时把它追加到 session 历史。
 * @param snapshot 要生效的新配置
 * @param label 用户操作名称
 * @returns 提交后的界面历史状态
 */
export async function commitConfiguration(
  snapshot: ConfigurationSnapshot,
  label: string,
): Promise<ConfigurationHistoryStatus> {
  return runConfigurationHistoryTransaction(async () => {
    /** 提交前 local storage 中真正生效的配置。 */
    const current = await getCurrentConfiguration();
    /** 与实际配置对齐的提交前历史。 */
    const previousHistory = alignConfigurationHistory(await getConfigurationHistory(), current);
    /** 追加新配置后的历史。 */
    const nextHistory = appendConfigurationHistory(previousHistory, snapshot, label);
    if (nextHistory === previousHistory) {
      return getConfigurationHistoryStatus(previousHistory);
    }
    // 先落盘真实配置：历史只是会话级辅助能力，写历史失败不应连带丢掉用户这次修改。
    await saveConfiguration(snapshot.groups, snapshot.enabled);
    /** 实际写入 session 的历史。 */
    const storedHistory = await saveConfigurationHistory(nextHistory);
    return storedHistory
      ? getConfigurationHistoryStatus(storedHistory)
      : EMPTY_CONFIGURATION_HISTORY_STATUS;
  });
}

/**
 * 沿历史时间线移动并使目标快照生效。
 * @param direction -1 表示撤销，1 表示重做
 * @returns 已恢复的配置及最新按钮状态；无法移动时返回 null
 */
async function restoreConfigurationHistory(
  direction: -1 | 1,
): Promise<{ snapshot: ConfigurationSnapshot; status: ConfigurationHistoryStatus } | null> {
  return runConfigurationHistoryTransaction(async () => {
    /** local storage 当前配置。 */
    const current = await getCurrentConfiguration();
    /** 与实际配置对齐后的当前历史。 */
    const previousHistory = alignConfigurationHistory(await getConfigurationHistory(), current);
    /** 游标移动后的历史。 */
    const nextHistory = moveConfigurationHistory(previousHistory, direction);
    if (!nextHistory) {
      return null;
    }
    /** 新游标指向的目标配置。 */
    const snapshot = cloneSnapshot(nextHistory.entries[nextHistory.cursor].snapshot);
    // 与提交同理：配置先生效，历史写入失败时最多退化为不可继续撤销 / 重做。
    await saveConfiguration(snapshot.groups, snapshot.enabled);
    /** 实际写入 session 的历史。 */
    const storedHistory = await saveConfigurationHistory(nextHistory);
    return {
      snapshot,
      status: storedHistory
        ? getConfigurationHistoryStatus(storedHistory)
        : EMPTY_CONFIGURATION_HISTORY_STATUS,
    };
  });
}

/**
 * 撤销最近一次配置修改。
 * @returns 已恢复的配置和状态；没有可撤销内容时返回 null
 */
export async function undoConfiguration() {
  return restoreConfigurationHistory(-1);
}

/**
 * 重做最近一次被撤销的配置修改。
 * @returns 已恢复的配置和状态；没有可重做内容时返回 null
 */
export async function redoConfiguration() {
  return restoreConfigurationHistory(1);
}

/**
 * 订阅跨扩展页面的配置历史变化。
 * @param onChange 历史状态变化回调
 * @returns 取消订阅函数
 */
export function watchConfigurationHistory(
  onChange: (status: ConfigurationHistoryStatus) => void,
): () => void {
  /** storage 变更监听器。 */
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ): void => {
    if (area !== 'session' || !(STORAGE_KEY_CONFIGURATION_HISTORY in changes)) {
      return;
    }
    /** 变更后的历史值。 */
    const history = changes[STORAGE_KEY_CONFIGURATION_HISTORY]?.newValue;
    onChange(
      isConfigurationHistory(history)
        ? getConfigurationHistoryStatus(history)
        : EMPTY_CONFIGURATION_HISTORY_STATUS,
    );
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
