import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Rule } from '@req-freedom/shared';
import { getEnabled, getRules, saveRules, setEnabled } from '@/utils/storage';
import { RULE_TYPE_LABELS } from '@/utils/labels';

/**
 * Popup 主界面：全局开关 + 规则快速启停
 */
export default function App() {
  /** 全局开关状态 */
  const [enabled, setEnabledState] = useState(true);
  /** 规则列表 */
  const [rules, setRules] = useState<Rule[]>([]);

  // 初始加载 storage 中的开关与规则
  useEffect(() => {
    void (async () => {
      setEnabledState(await getEnabled());
      setRules(await getRules());
    })();
  }, []);

  /**
   * 切换全局开关并持久化
   */
  const handleToggleGlobal = async (): Promise<void> => {
    /** 切换后的开关值 */
    const next = !enabled;
    setEnabledState(next);
    await setEnabled(next);
  };

  /**
   * 切换单条规则的启用状态并持久化
   * @param id 规则 ID
   */
  const handleToggleRule = async (id: string): Promise<void> => {
    /** 更新后的规则列表 */
    const next = rules.map((rule) =>
      rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
    );
    setRules(next);
    await saveRules(next);
  };

  /**
   * 打开完整的规则管理页（options 页面）
   */
  const handleOpenOptions = (): void => {
    void browser.runtime.openOptionsPage();
  };

  return (
    <div className="popup">
      <header className="popup-header">
        <h1>Req Freedom</h1>
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={handleToggleGlobal} />
          <span>{enabled ? '已启用' : '已停用'}</span>
        </label>
      </header>

      <ul className="rule-list">
        {rules.length === 0 && <li className="empty">暂无规则，去管理页添加</li>}
        {rules.map((rule) => (
          <li key={rule.id} className="rule-item">
            <label>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => handleToggleRule(rule.id)}
              />
              <span className="rule-name">{rule.name}</span>
            </label>
            <span className="rule-type">{RULE_TYPE_LABELS[rule.type]}</span>
          </li>
        ))}
      </ul>

      <footer>
        <button type="button" onClick={handleOpenOptions}>
          管理规则
        </button>
      </footer>
    </div>
  );
}
