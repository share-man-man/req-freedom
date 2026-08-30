import { describe, expect, it } from 'vitest';
import type { RuleGroup } from '@req-freedom/shared';
import {
  appendConfigurationHistory,
  createConfigurationHistory,
  getConfigurationHistoryStatus,
  moveConfigurationHistory,
  type ConfigurationSnapshot,
} from './configuration-history';

/**
 * 创建便于断言的最小配置快照。
 * @param enabled 全局开关
 * @param groups 规则分组
 * @returns 配置快照
 */
function createSnapshot(enabled: boolean, groups: RuleGroup[] = []): ConfigurationSnapshot {
  return { enabled, groups };
}

describe('configuration history', () => {
  it('appends snapshots and moves the cursor for undo and redo', () => {
    /** 初始配置历史。 */
    const initial = createConfigurationHistory(createSnapshot(true), '2026-01-01T00:00:00.000Z');
    /** 追加一次修改后的历史。 */
    const committed = appendConfigurationHistory(
      initial,
      createSnapshot(false),
      'disable',
      '2026-01-01T00:00:01.000Z',
    );
    /** 撤销后的历史。 */
    const undone = moveConfigurationHistory(committed, -1);
    /** 重做后的历史。 */
    const redone = undone ? moveConfigurationHistory(undone, 1) : null;

    expect(committed.cursor).toBe(1);
    expect(undone?.cursor).toBe(0);
    expect(redone?.cursor).toBe(1);
    expect(getConfigurationHistoryStatus(committed)).toEqual({
      canUndo: true,
      canRedo: false,
      undoLabel: 'disable',
      redoLabel: null,
    });
  });

  it('drops the redo branch after committing from an undone snapshot', () => {
    /** A 节点。 */
    const historyA = createConfigurationHistory(createSnapshot(true), '2026-01-01T00:00:00.000Z');
    /** A-B 时间线。 */
    const historyB = appendConfigurationHistory(historyA, createSnapshot(false), 'B');
    /** 用不同分组构造的 C 节点。 */
    const snapshotC = createSnapshot(true, [{
      id: 'group-c',
      name: 'C',
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      rules: [],
    }]);
    /** A-B-C 时间线。 */
    const historyC = appendConfigurationHistory(historyB, snapshotC, 'C');
    /** 回到 B 后的时间线。 */
    const undone = moveConfigurationHistory(historyC, -1);
    expect(undone).not.toBeNull();
    /** 从 B 分叉得到的 D 节点。 */
    const historyD = appendConfigurationHistory(undone!, createSnapshot(true), 'D');

    expect(historyD.entries.map((entry) => entry.label)).toEqual([null, 'B', 'D']);
    expect(historyD.cursor).toBe(2);
    expect(getConfigurationHistoryStatus(historyD).canRedo).toBe(false);
  });

  it('does not append a duplicate snapshot', () => {
    /** 初始快照。 */
    const snapshot = createSnapshot(true);
    /** 初始历史。 */
    const history = createConfigurationHistory(snapshot);

    expect(appendConfigurationHistory(history, snapshot, 'duplicate')).toBe(history);
  });
});
