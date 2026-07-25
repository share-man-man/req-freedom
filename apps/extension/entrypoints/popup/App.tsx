import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { CheckCircle2, ChevronDown, Settings2, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuleGroup, RuleMatchSummary } from '@req-freedom/shared';
import {
  RULE_HIGHLIGHT_QUERY_PARAM,
  RUNTIME_MSG_CLEAR_RULE_MATCHES,
  RUNTIME_MSG_GET_RULE_MATCH_SUMMARY,
} from '@req-freedom/shared';
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
  const { t } = useTranslation();
  /** 全局开关状态 */
  const [enabled, setEnabledState] = useState(true);
  /** 规则分组列表 */
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  /** 已折叠的分组 ID 集合，仅保留在当前弹窗会话中 */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  /** 当前页面累计命中次数；由扩展图标徽标统一承载两条执行通道的计数。 */
  const [matchedCount, setMatchedCount] = useState(0);
  /** 当前页面至少命中过一次的业务规则 ID。 */
  const [matchedRuleIds, setMatchedRuleIds] = useState<string[]>([]);
  /** 点击 popup 时所在的标签页 ID。 */
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // 初始加载 storage 中的开关与分组
  useEffect(() => {
    void (async () => {
      /** 并行读取配置，缩短 popup 首次渲染等待。 */
      const [nextEnabled, nextGroups] = await Promise.all([getEnabled(), getGroups()]);
      setEnabledState(nextEnabled);
      setGroups(nextGroups);
      try {
        /** 点击扩展图标打开 popup 时所在的标签页。 */
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id === undefined) {
          return;
        }
        setActiveTabId(activeTab.id);
        /** background 合并后的 DNR 与页面补丁命中摘要。 */
        const summary = (await browser.runtime.sendMessage({
          type: RUNTIME_MSG_GET_RULE_MATCH_SUMMARY,
          tabId: activeTab.id,
        })) as RuleMatchSummary | undefined;
        setMatchedCount(summary?.count ?? 0);
        setMatchedRuleIds(summary?.ruleIds ?? []);
      } catch {
        // 特殊页面或浏览器不支持命中明细查询时，不展示命中提示即可。
      }
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
   * 清空当前标签页累计的规则命中次数
   */
  const handleClearMatchedCount = async (): Promise<void> => {
    try {
      if (activeTabId === null) {
        return;
      }
      await browser.runtime.sendMessage({
        type: RUNTIME_MSG_CLEAR_RULE_MATCHES,
        tabId: activeTabId,
      });
      setMatchedCount(0);
      setMatchedRuleIds([]);
    } catch {
      // 清空失败时保留原计数，用户可再次尝试。
    }
  };

  /**
   * 打开规则管理页并定位指定规则。
   * @param ruleId 要定位的业务规则 ID
   */
  const handleJumpToRule = (ruleId: string): void => {
    /** 带目标规则查询参数的 options 页面地址。 */
    const url = browser.runtime.getURL(
      `/options.html?${RULE_HIGHLIGHT_QUERY_PARAM}=${encodeURIComponent(ruleId)}`,
    );
    void browser.tabs.create({ url });
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
  /** 便于规则列表快速判断高亮状态的命中 ID 集合。 */
  const matchedRuleIdSet = new Set(matchedRuleIds);

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
              {enabled ? t('popup.activeCount', { count: activeCount }) : t('popup.globallyDisabled')}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggleGlobal} />
      </header>

      {/* 当前页面命中提示：计数同时包含 DNR 与页面补丁通道。 */}
      {matchedCount > 0 && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-primary">
          <CheckCircle2 className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 text-xs font-medium">
            {t('popup.matchedCount', { count: matchedCount })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => void handleClearMatchedCount()}
          >
            {t('popup.clearMatchedCount')}
          </Button>
        </div>
      )}

      {/* 分组列表 */}
      <div className="max-h-96 overflow-y-auto p-2">
        {!hasRules ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('popup.noRules')}</p>
            <p className="text-xs text-muted-foreground/70">{t('popup.noRulesHint')}</p>
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
                      title={collapsedGroupIds.has(group.id) ? t('popup.expandGroup') : t('popup.collapseGroup')}
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
                    {t('popup.ruleCount', { count: group.rules.length })}
                  </Badge>
                </div>

                {/* 组内规则：整组停用时淡化 */}
                {!collapsedGroupIds.has(group.id) && group.rules.length > 0 && (
                  <ul
                    className={`flex flex-col gap-0.5 border-t border-border p-1 ${
                      group.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    {group.rules.map((rule) => {
                      /** 当前规则是否在本页面至少命中过一次。 */
                      const isMatched = matchedRuleIdSet.has(rule.id);
                      return (
                        <li
                          key={rule.id}
                          className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                            isMatched
                              ? 'border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/20'
                              : 'border-transparent hover:bg-muted/60'
                          }`}
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
                          <div className="flex shrink-0 items-center gap-1">
                            <Badge variant={rule.enabled ? 'default' : 'muted'} className="shrink-0">
                              {rule.channel === 'dnr'
                                ? 'DNR'
                                : t('templateLibrary.channelPagePatch')}
                            </Badge>
                            {isMatched && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 text-primary hover:bg-primary/10 hover:text-primary"
                                title={t('popup.jumpToRule')}
                                aria-label={t('popup.jumpToRule')}
                                onClick={() => handleJumpToRule(rule.id)}
                              >
                                <Target className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
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
          {t('popup.manageRules')}
        </Button>
      </footer>
    </div>
  );
}
