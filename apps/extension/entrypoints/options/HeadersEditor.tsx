import type { HeaderModification } from '@req-freedom/shared';
import {
  APPENDABLE_REQUEST_HEADERS,
  HeaderOperation,
  HeaderTarget,
  isAppendableRequestHeader,
} from '@req-freedom/shared';
import { HEADER_OPERATION_LABELS, HEADER_TARGET_LABELS } from '@/utils/labels';

/**
 * 判断某条修改项是否为「请求头 + 追加」组合
 *
 * 该组合下 Chrome DNR 只接受固定白名单里的头，因此头名改用下拉选择而非自由输入。
 * @param item 单条 Header 修改项
 * @returns 是否为请求头 append
 */
function isRequestAppend(item: HeaderModification): boolean {
  return item.target === HeaderTarget.Request && item.operation === HeaderOperation.Append;
}

/**
 * 判断某条修改项是否属于「请求头 + 追加 + 非白名单头」的无效组合
 *
 * 正常经 UI 编辑不会命中（头名被下拉限定），主要作为导入/历史数据的兜底提示。
 * @param item 单条 Header 修改项
 * @returns 是否为会被忽略的无效 append
 */
function isIneffectiveAppend(item: HeaderModification): boolean {
  return (
    isRequestAppend(item) && item.header.trim() !== '' && !isAppendableRequestHeader(item.header)
  );
}

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
   *
   * 应用补丁后做一次归一：若结果落入「请求头 + 追加」且原头名不在 append 白名单，
   * 则清空头名，让其回到下拉的占位态，避免残留一个无效的自定义头。
   * @param index 行下标
   * @param patch 要修改的字段
   */
  const handleRowChange = (index: number, patch: Partial<HeaderModification>): void => {
    onChange(
      value.map((item, i) => {
        if (i !== index) {
          return item;
        }
        /** 应用补丁后的新行 */
        const next = { ...item, ...patch };
        if (isRequestAppend(next) && next.header.trim() !== '' && !isAppendableRequestHeader(next.header)) {
          next.header = '';
        }
        return next;
      }),
    );
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
        <div className="headers-editor-item" key={index}>
          <div className="kv-row">
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
            {/* 请求头 + 追加：头名限定为白名单下拉；其余情况自由输入 */}
            {isRequestAppend(item) ? (
              <select
                value={
                  isAppendableRequestHeader(item.header) ? item.header.trim().toLowerCase() : ''
                }
                onChange={(e) => handleRowChange(index, { header: e.target.value })}
              >
                <option value="" disabled>
                  选择可追加的请求头
                </option>
                {APPENDABLE_REQUEST_HEADERS.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            ) : (
              <input
                placeholder="Header 名称"
                value={item.header}
                onChange={(e) => handleRowChange(index, { header: e.target.value })}
              />
            )}
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
          {/* 请求头 + 追加模式下：指明自定义头的出口是「设置」，避免用户卡在下拉里 */}
          {isRequestAppend(item) && (
            <p className="headers-editor-hint">
              「追加」仅支持以上少数可多值的标准头；公司自定义头请改用「设置」，头名可任意填写。
            </p>
          )}
          {/* 兜底：导入/历史数据里残留的无效 append 组合，仍给出提示 */}
          {isIneffectiveAppend(item) && (
            <p className="headers-editor-warning">
              自定义请求头不支持「追加」，会被浏览器静默忽略，请改用「设置」。仅 Cookie、
              User-Agent、X-Forwarded-For 等少数标准头可追加。
            </p>
          )}
        </div>
      ))}
      <button type="button" onClick={handleAdd}>
        + 添加修改项
      </button>
      {/* 响应头改写在浏览器「网络」面板里看不到，但实际已生效 */}
      <p className="headers-editor-hint">
        提示：<strong>请求头</strong>的改写能在浏览器「网络」面板看到；
        <strong>响应头</strong>的改写不会显示在面板里，看不到不等于没生效，可用 <code>response.headers.get('...')</code> 读取验证。
      </p>
    </div>
  );
}
