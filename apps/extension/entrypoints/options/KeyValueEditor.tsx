import { useState } from 'react';

/** 编辑中的单行键值对 */
interface KeyValueRow {
  /** 键 */
  key: string;
  /** 值 */
  value: string;
}

interface KeyValueEditorProps {
  /** 初始键值对（仅在组件挂载时读取一次） */
  initialValue: Record<string, string>;
  /** 键值对变化回调（已过滤空键并去除键两侧空白） */
  onChange: (next: Record<string, string>) => void;
}

/**
 * 键值对编辑器：用于查询参数、Mock 响应头等 Record 结构的编辑
 */
export default function KeyValueEditor({ initialValue, onChange }: KeyValueEditorProps) {
  /** 编辑中的行列表（允许键暂时为空，提交时过滤） */
  const [rows, setRows] = useState<KeyValueRow[]>(() =>
    Object.entries(initialValue).map(([key, value]) => ({ key, value })),
  );

  /**
   * 更新行列表并把有效行组装成 Record 通知外部
   * @param next 新的行列表
   */
  const commit = (next: KeyValueRow[]): void => {
    setRows(next);
    /** 过滤空键后组装的结果 */
    const record: Record<string, string> = {};
    for (const row of next) {
      if (row.key.trim()) {
        record[row.key.trim()] = row.value;
      }
    }
    onChange(record);
  };

  /**
   * 修改某一行的键或值
   * @param index 行下标
   * @param patch 要修改的字段
   */
  const handleRowChange = (index: number, patch: Partial<KeyValueRow>): void => {
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="kv-editor">
      {rows.map((row, index) => (
        // 行没有稳定 ID，用下标作为 key（仅增删改场景，无排序需求）
        <div className="kv-row" key={index}>
          <input
            placeholder="键"
            value={row.key}
            onChange={(e) => handleRowChange(index, { key: e.target.value })}
          />
          <input
            placeholder="值"
            value={row.value}
            onChange={(e) => handleRowChange(index, { value: e.target.value })}
          />
          <button type="button" onClick={() => commit(rows.filter((_, i) => i !== index))}>
            删除
          </button>
        </div>
      ))}
      <button type="button" onClick={() => commit([...rows, { key: '', value: '' }])}>
        + 添加一项
      </button>
    </div>
  );
}
