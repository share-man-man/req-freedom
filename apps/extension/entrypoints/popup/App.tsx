import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Settings2, Zap } from 'lucide-react';
import type { Rule } from '@req-freedom/shared';
import { getEnabled, getRules, saveRules, setEnabled } from '@/utils/storage';
import { RULE_TYPE_LABELS } from '@/utils/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

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
   * @param next 切换后的开关值
   */
  const handleToggleGlobal = async (next: boolean): Promise<void> => {
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

  /** 已启用规则数量 */
  const activeCount = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="flex flex-col">
      {/* 顶部：品牌 + 全局开关 */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Zap className="size-4" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Req Freedom</h1>
            <p className="text-xs text-muted-foreground">
              {enabled ? `${activeCount} 条规则生效中` : '已全局停用'}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggleGlobal} />
      </header>

      {/* 规则列表 */}
      <div className="max-h-80 overflow-y-auto p-2">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">暂无规则</p>
            <p className="text-xs text-muted-foreground/70">去管理页添加你的第一条规则</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={() => handleToggleRule(rule.id)}
                  />
                  <span
                    className={`truncate text-sm ${
                      rule.enabled ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                    title={rule.name}
                  >
                    {rule.name}
                  </span>
                </div>
                <Badge variant={rule.enabled ? 'default' : 'muted'} className="shrink-0">
                  {RULE_TYPE_LABELS[rule.type]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部：进入管理页 */}
      <footer className="border-t border-border p-3">
        <Button variant="outline" size="sm" className="w-full" onClick={handleOpenOptions}>
          <Settings2 />
          管理规则
        </Button>
      </footer>
    </div>
  );
}
