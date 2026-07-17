import { useEffect, useState } from 'react';
import type { Rule } from '@req-freedom/shared';
import {
  DEFAULT_MOCK_STATUS,
  HeaderOperation,
  HeaderTarget,
  MatchType,
  RuleType,
} from '@req-freedom/shared';
import { getRules, saveRules } from '@/utils/storage';
import { MATCH_TYPE_LABELS, RULE_TYPE_LABELS } from '@/utils/labels';
import RuleEditor from './RuleEditor';

/**
 * 按规则类型生成一条示例规则（作为新建规则的模板）
 * @param type 规则类型
 * @returns 预填充好的新规则
 */
function createSampleRule(type: RuleType): Rule {
  /** 所有规则共享的基础字段 */
  const base = {
    id: crypto.randomUUID(),
    name: `${RULE_TYPE_LABELS[type]}规则`,
    enabled: false,
    matchType: MatchType.Contains,
    pattern: 'example.com/api',
  };

  switch (type) {
    case RuleType.Block:
      return { ...base, type };
    case RuleType.Redirect:
      return { ...base, type, redirectUrl: 'http://localhost:3000/api' };
    case RuleType.InjectParams:
      return { ...base, type, params: { debug: '1' } };
    case RuleType.ModifyHeaders:
      return {
        ...base,
        type,
        headers: [
          {
            target: HeaderTarget.Request,
            operation: HeaderOperation.Set,
            header: 'X-Req-Freedom',
            value: '1',
          },
        ],
      };
    case RuleType.MockResponse:
      return {
        ...base,
        type,
        statusCode: DEFAULT_MOCK_STATUS,
        body: JSON.stringify({ code: 0, data: 'mocked by req-freedom' }),
      };
    case RuleType.Delay:
      return { ...base, type, delayMs: 2000 };
  }
}

/**
 * Options 主界面：规则的增删改与启停
 */
export default function App() {
  /** 规则列表 */
  const [rules, setRules] = useState<Rule[]>([]);
  /** 正在编辑的规则 ID，null 表示未在编辑 */
  const [editingId, setEditingId] = useState<string | null>(null);

  // 初始加载规则
  useEffect(() => {
    void getRules().then(setRules);
  }, []);

  /** 正在编辑的规则对象 */
  const editingRule = rules.find((rule) => rule.id === editingId) ?? null;

  /**
   * 更新规则列表并持久化
   * @param next 新的规则列表
   */
  const updateRules = async (next: Rule[]): Promise<void> => {
    setRules(next);
    await saveRules(next);
  };

  /**
   * 新增一条指定类型的示例规则，并直接进入编辑态
   * @param type 规则类型
   */
  const handleAdd = (type: RuleType): void => {
    /** 新建的示例规则 */
    const rule = createSampleRule(type);
    void updateRules([...rules, rule]);
    setEditingId(rule.id);
  };

  /**
   * 保存编辑结果并退出编辑态
   * @param next 编辑后的规则
   */
  const handleSave = (next: Rule): void => {
    void updateRules(rules.map((rule) => (rule.id === next.id ? next : rule)));
    setEditingId(null);
  };

  /**
   * 删除规则（若正在编辑该规则则一并退出编辑态）
   * @param id 规则 ID
   */
  const handleDelete = (id: string): void => {
    void updateRules(rules.filter((rule) => rule.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
  };

  /**
   * 切换规则启用状态
   * @param id 规则 ID
   */
  const handleToggle = (id: string): void => {
    void updateRules(
      rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)),
    );
  };

  return (
    <div className="options">
      <h1>Req Freedom 规则管理</h1>

      <section className="toolbar">
        <span>新建规则：</span>
        {Object.values(RuleType).map((type) => (
          <button key={type} type="button" onClick={() => handleAdd(type)}>
            + {RULE_TYPE_LABELS[type]}
          </button>
        ))}
      </section>

      {editingRule && (
        <RuleEditor
          // key 保证切换编辑对象时重建草稿状态
          key={editingRule.id}
          rule={editingRule}
          onSave={handleSave}
          onCancel={() => setEditingId(null)}
        />
      )}

      <table className="rule-table">
        <thead>
          <tr>
            <th>启用</th>
            <th>名称</th>
            <th>类型</th>
            <th>匹配方式</th>
            <th>匹配模式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                暂无规则，点击上方按钮创建
              </td>
            </tr>
          )}
          {rules.map((rule) => (
            <tr key={rule.id} className={rule.id === editingId ? 'editing' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggle(rule.id)}
                />
              </td>
              <td>{rule.name}</td>
              <td>{RULE_TYPE_LABELS[rule.type]}</td>
              <td>{MATCH_TYPE_LABELS[rule.matchType]}</td>
              <td className="pattern">{rule.pattern}</td>
              <td className="actions">
                <button type="button" onClick={() => setEditingId(rule.id)}>
                  编辑
                </button>
                <button type="button" onClick={() => handleDelete(rule.id)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
