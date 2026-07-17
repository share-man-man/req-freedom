import type { HeaderModification } from '@req-freedom/shared';
import { HeaderOperation, HeaderTarget } from '@req-freedom/shared';
import { HEADER_OPERATION_LABELS, HEADER_TARGET_LABELS } from '@/utils/labels';

interface HeadersEditorProps {
  /** 当前修改项列表 */
  value: HeaderModification[];
  /** 修改项变化回调 */
  onChange: (next: HeaderModification[]) => void;
}

/**
 * Header 修改项编辑器：编辑「目标 + 操作 + 名称 + 值」的列表
 */
export default function HeadersEditor({ value, onChange }: HeadersEditorProps) {
  /**
   * 修改某一行的字段
   * @param index 行下标
   * @param patch 要修改的字段
   */
  const handleRowChange = (index: number, patch: Partial<HeaderModification>): void => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  /**
   * 新增一行默认修改项
   */
  const handleAdd = (): void => {
    onChange([
      ...value,
      {
        target: HeaderTarget.Request,
        operation: HeaderOperation.Set,
        header: '',
        value: '',
      },
    ]);
  };

  return (
    <div className="headers-editor">
      {value.map((item, index) => (
        // 行没有稳定 ID，用下标作为 key（仅增删改场景，无排序需求）
        <div className="kv-row" key={index}>
          <select
            value={item.target}
            onChange={(e) => handleRowChange(index, { target: e.target.value as HeaderTarget })}
          >
            {Object.values(HeaderTarget).map((target) => (
              <option key={target} value={target}>
                {HEADER_TARGET_LABELS[target]}
              </option>
            ))}
          </select>
          <select
            value={item.operation}
            onChange={(e) =>
              handleRowChange(index, { operation: e.target.value as HeaderOperation })
            }
          >
            {Object.values(HeaderOperation).map((operation) => (
              <option key={operation} value={operation}>
                {HEADER_OPERATION_LABELS[operation]}
              </option>
            ))}
          </select>
          <input
            placeholder="Header 名称"
            value={item.header}
            onChange={(e) => handleRowChange(index, { header: e.target.value })}
          />
          <input
            placeholder="值（移除时留空）"
            value={item.value ?? ''}
            disabled={item.operation === HeaderOperation.Remove}
            onChange={(e) => handleRowChange(index, { value: e.target.value })}
          />
          <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            删除
          </button>
        </div>
      ))}
      <button type="button" onClick={handleAdd}>
        + 添加修改项
      </button>
    </div>
  );
}
