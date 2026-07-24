import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ChevronDown, Settings2 } from 'lucide-react';
import type { RuleGroup } from '@req-freedom/shared';
import { collectActiveRules } from '@req-freedom/core';
import { getEnabled, getGroups, saveGroups, setEnabled } from '@/utils/storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LogoMark } from '@/components/logo-mark';

/**
 * Popup 主界面：全局开关 + 按分组快速启停
 */
export default function App() {
  /** 全局开关状态 */
  const [enabled, setEnabledState] = useState(true);
  /** 规则分组列表 */
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  /** 已折叠的分组 ID 集合，仅保留在当前弹窗会话中 */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  // 初始加载 storage 中的开关与分组
  useEffect(() => {
    void (async () => {
      setEnabledState(await getEnabled());
      setGroups(await getGroups());
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
   * 更新分组列表并持久化
   * @param next 新的分组列表
   * @param updatedGroupIds 需要刷新最近更新时间的分组 ID
   */
  const persist = async (next: RuleGroup[], updatedGroupIds: readonly string[] = []): Promise<void> => {
    /** 本次操作发生时刻，用于刷新受影响分组的摘要时间。 */
    const updatedAt = new Date().toISOString();
    /** 需要刷新摘要时间的分组 ID 集合。 */
    const updatedGroupIdSet = new Set(updatedGroupIds);
    /** 已写入最新摘要时间的持久化数据。 */
    const groupsWithUpdatedAt = next.map((group) =>
      updatedGroupIdSet.has(group.id) ? { ...group, updatedAt } : group,
    );
    setGroups(groupsWithUpdatedAt);
    await saveGroups(groupsWithUpdatedAt);
  };

  /**
   * 切换整组启用状态
   * @param groupId 分组 ID
   */
  const handleToggleGroup = async (groupId: string): Promise<void> => {
    await persist(
      groups.map((group) =>
        group.id === groupId ? { ...group, enabled: !group.enabled } : group,
      ),
      [groupId],
    );
  };

  /**
   * 切换单条规则启用状态
   * @param ruleId 规则 ID
   */
  const handleToggleRule = async (ruleId: string): Promise<void> => {
    /** 被切换规则所属的分组。 */
    const ownerGroupId = groups.find((group) => group.rules.some((rule) => rule.id === ruleId))?.id;
    await persist(
      groups.map((group) => ({
        ...group,
        rules: group.rules.map((rule) =>
          rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule,
        ),
      })),
      ownerGroupId ? [ownerGroupId] : [],
    );
  };

  /**
   * 切换一个分组的折叠状态，不影响规则的实际启用状态或持久化数据
   * @param groupId 要折叠或展开的分组 ID
   */
  const handleToggleCollapse = (groupId: string): void => {
    setCollapsedGroupIds((previousGroupIds) => {
      /** 变更后的折叠分组集合 */
      const nextGroupIds = new Set(previousGroupIds);
      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId);
      } else {
        nextGroupIds.add(groupId);
      }
      return nextGroupIds;
    });
  };

  /**
   * 打开完整的规则管理页（options 页面）
   */
  const handleOpenOptions = (): void => {
    void browser.runtime.openOptionsPage();
  };

  /** 当前生效规则数量（分组与规则同时启用，且全局开启） */
  const activeCount = enabled ? collectActiveRules(groups).length : 0;
  /** 是否已存在任意规则 */
  const hasRules = groups.some((group) => group.rules.length > 0);

  return (
    <div className="flex flex-col">
      {/* 顶部：品牌 + 全局开关 */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LogoMark className="size-4" />
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

      {/* 分组列表 */}
      <div className="max-h-96 overflow-y-auto p-2">
        {!hasRules ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">暂无规则</p>
            <p className="text-xs text-muted-foreground/70">去管理页添加你的第一条规则</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-border">
                {/* 分组标题行：折叠控制 + 整组开关 */}
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title={collapsedGroupIds.has(group.id) ? '展开分组' : '折叠分组'}
                      aria-expanded={!collapsedGroupIds.has(group.id)}
                      onClick={() => handleToggleCollapse(group.id)}
                    >
                      <ChevronDown
                        className={`size-3.5 transition-transform ${
                          collapsedGroupIds.has(group.id) ? '-rotate-90' : ''
                        }`}
                      />
                    </button>
                    <Switch
                      checked={group.enabled}
                      onCheckedChange={() => handleToggleGroup(group.id)}
                    />
                    <span
                      className={`truncate text-sm font-medium ${
                        group.enabled ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                      title={group.name}
                    >
                      {group.name}
                    </span>
                  </div>
                  <Badge variant="muted" className="shrink-0">
                    {group.rules.length} 条
                  </Badge>
                </div>

                {/* 组内规则：整组停用时淡化 */}
                {!collapsedGroupIds.has(group.id) && group.rules.length > 0 && (
                  <ul
                    className={`flex flex-col gap-0.5 border-t border-border p-1 ${
                      group.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    {group.rules.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
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
                          {rule.channel === 'dnr' ? 'DNR' : '页面补丁'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
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
