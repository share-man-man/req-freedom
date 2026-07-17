import { useState } from 'react';
import type { Rule } from '@req-freedom/shared';
import { MatchType, RuleType } from '@req-freedom/shared';
import { MATCH_TYPE_LABELS, RULE_TYPE_LABELS } from '@/utils/labels';
import HeadersEditor from './HeadersEditor';
import KeyValueEditor from './KeyValueEditor';

interface RuleEditorProps {
  /** 待编辑的规则（编辑器内部维护草稿副本，保存前不影响外部） */
  rule: Rule;
  /** 保存回调，参数为编辑后的完整规则 */
  onSave: (rule: Rule) => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 校验规则草稿的合法性
 * @param rule 待校验的规则
 * @returns 错误信息；合法时返回 null
 */
function validateRule(rule: Rule): string | null {
  if (!rule.name.trim()) {
    return '规则名称不能为空';
  }
  if (!rule.pattern.trim()) {
    return '匹配模式不能为空';
  }
  // 正则匹配方式需要保证表达式可编译
  if (rule.matchType === MatchType.Regex) {
    try {
      new RegExp(rule.pattern);
    } catch {
      return '正则表达式语法错误';
    }
  }
  switch (rule.type) {
    case RuleType.Redirect:
      return rule.redirectUrl.trim() ? null : '重定向目标地址不能为空';
    case RuleType.MockResponse:
      return rule.statusCode >= 100 && rule.statusCode <= 599
        ? null
        : '状态码需在 100 - 599 之间';
    case RuleType.Delay:
      return Number.isFinite(rule.delayMs) && rule.delayMs >= 0 ? null : '延迟时长需为非负数字';
    default:
      return null;
  }
}

/**
 * 规则编辑表单：公共字段 + 按规则类型渲染的专属字段
 */
export default function RuleEditor({ rule, onSave, onCancel }: RuleEditorProps) {
  /** 编辑中的草稿（深拷贝，避免直接修改外部对象） */
  const [draft, setDraft] = useState<Rule>(() => structuredClone(rule));
  /** 校验错误信息 */
  const [error, setError] = useState<string | null>(null);

  /**
   * 校验并提交保存
   */
  const handleSave = (): void => {
    /** 草稿的校验结果 */
    const message = validateRule(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
  };

  return (
    <section className="editor">
      <h2>
        编辑规则
        <span className="editor-type">{RULE_TYPE_LABELS[draft.type]}</span>
      </h2>

      <div className="form-row">
        <label>规则名称</label>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      <div className="form-row">
        <label>匹配方式</label>
        <select
          value={draft.matchType}
          onChange={(e) => setDraft({ ...draft, matchType: e.target.value as MatchType })}
        >
          {Object.values(MatchType).map((matchType) => (
            <option key={matchType} value={matchType}>
              {MATCH_TYPE_LABELS[matchType]}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label>匹配模式</label>
        <input
          className="mono"
          placeholder="如 example.com/api 或 https://api\.example\.com/(.*)"
          value={draft.pattern}
          onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
        />
      </div>

      {/* ---------- 按规则类型渲染专属字段 ---------- */}

      {draft.type === RuleType.Redirect && (
        <div className="form-row">
          <label>重定向目标</label>
          <input
            className="mono"
            placeholder="正则匹配时支持 \1 捕获组引用"
            value={draft.redirectUrl}
            onChange={(e) => setDraft({ ...draft, redirectUrl: e.target.value })}
          />
        </div>
      )}

      {draft.type === RuleType.InjectParams && (
        <div className="form-row">
          <label>注入参数</label>
          <KeyValueEditor
            initialValue={draft.params}
            onChange={(params) => setDraft({ ...draft, params })}
          />
        </div>
      )}

      {draft.type === RuleType.ModifyHeaders && (
        <div className="form-row">
          <label>Header 修改项</label>
          <HeadersEditor
            value={draft.headers}
            onChange={(headers) => setDraft({ ...draft, headers })}
          />
        </div>
      )}

      {draft.type === RuleType.MockResponse && (
        <>
          <div className="form-row">
            <label>状态码</label>
            <input
              type="number"
              min={100}
              max={599}
              value={draft.statusCode}
              onChange={(e) => setDraft({ ...draft, statusCode: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <label>额外延迟（毫秒）</label>
            <input
              type="number"
              min={0}
              value={draft.delayMs ?? 0}
              onChange={(e) => setDraft({ ...draft, delayMs: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <label>响应体</label>
            <textarea
              className="mono"
              rows={6}
              placeholder='{"code": 0, "data": {}}'
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>附加响应头</label>
            <KeyValueEditor
              initialValue={draft.responseHeaders ?? {}}
              onChange={(responseHeaders) => setDraft({ ...draft, responseHeaders })}
            />
          </div>
        </>
      )}

      {draft.type === RuleType.Delay && (
        <div className="form-row">
          <label>延迟时长（毫秒）</label>
          <input
            type="number"
            min={0}
            value={draft.delayMs}
            onChange={(e) => setDraft({ ...draft, delayMs: Number(e.target.value) })}
          />
        </div>
      )}

      {error && <p className="editor-error">{error}</p>}

      <div className="editor-actions">
        <button type="button" className="primary" onClick={handleSave}>
          保存
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}
