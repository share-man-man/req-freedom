import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { AlertTriangle, CheckCircle2, ChevronDown, Settings2, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DnrRegistrationIssues, RuleGroup, RuleHitSummary } from '@req-freedom/shared';
import {
  RULE_HIGHLIGHT_QUERY_PARAM,
  RUNTIME_MSG_CLEAR_RULE_HITS,
  RUNTIME_MSG_GET_RULE_HIT_SUMMARY,
} from '@req-freedom/shared';
import { collectActiveRules } from '@req-freedom/core';
import {
  getDnrIssues,
  getEnabled,
  getGroups,
  saveGroups,
  setEnabled,
  watchDnrIssues,
} from '@/utils/storage';
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
  /** 当前页面命中过的业务规则 ID，已按规则去重。 */
  const [hitRuleIds, setHitRuleIds] = useState<string[]>([]);
  /** 命中日志是否已因超出上限丢弃过最早的记录。 */
  const [hitsTruncated, setHitsTruncated] = useState(false);
  /** 点击 popup 时所在的标签页 ID。 */
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  /** 各规则的 DNR 注册失败记录，用于标出「规则没生效」而非「没命中」。 */
  const [dnrIssues, setDnrIssues] = useState<DnrRegistrationIssues>({});
  /** 命中摘要的加载状态，用于区分“零命中”和“读取失败”。 */
  const [hitSummaryStatus, setHitSummaryStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  /**
   * 读取当前活动标签页的命中摘要。
   */
  const loadRuleHitSummary = async (): Promise<void> => {
    setHitSummaryStatus('loading');
    try {
      /** popup 当前关联的活动标签页。 */
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined) {
        setHitSummaryStatus('error');
        return;
      }
      setActiveTabId(activeTab.id);
      /** background 合并后的两条通道命中摘要。 */
      const summary = (await browser.runtime.sendMessage({
        type: RUNTIME_MSG_GET_RULE_HIT_SUMMARY,
        tabId: activeTab.id,
      })) as RuleHitSummary | undefined;
      if (!summary) {
        setHitSummaryStatus('error');
        return;
      }
      setHitRuleIds(summary.ruleIds);
      setHitsTruncated(summary.truncated);
      setHitSummaryStatus('ready');
    } catch {
      setHitSummaryStatus('error');
    }
  };

  // 注册失败记录由 background 每轮同步后写入 storage.session，这里读取一次并订阅后续变化
  useEffect(() => {
    void getDnrIssues().then(setDnrIssues);
    return watchDnrIssues(setDnrIssues);
  }, []);

  // 初始加载 storage 中的开关与分组
  useEffect(() => {
    void (async () => {
      /** 并行读取配置，缩短 popup 首次渲染等待。 */
      const [nextEnabled, nextGroups] = await Promise.all([getEnabled(), getGroups()]);
      setEnabledState(nextEnabled);
      setGroups(nextGroups);
      await loadRuleHitSummary();
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
   * 清空当前标签页累计的命中日志。
   */
  const handleClearHits = async (): Promise<void> => {
    if (activeTabId === null) {
      return;
    }
    try {
      await browser.runtime.sendMessage({
        type: RUNTIME_MSG_CLEAR_RULE_HITS,
        tabId: activeTabId,
      });
      setHitRuleIds([]);
      setHitsTruncated(false);
    } catch {
      setHitSummaryStatus('error');
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
  /** 便于规则列表判断命中状态的集合。 */
  const hitRuleIdSet = new Set(hitRuleIds);


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

      {/* 当前页面命中提示：总数同时包含 DNR 与页面补丁通道。 */}
      {hitRuleIds.length > 0 && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-primary">
          <CheckCircle2 className="mt-px size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-4">
              {t('popup.hitTotal', { count: hitRuleIds.length })}
            </p>
            {hitsTruncated && (
              <p className="mt-0.5 text-[11px] text-primary/80">
                {t('popup.hitsTruncated')}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-4 shrink-0 px-1.5 text-xs leading-4 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => void handleClearHits()}
          >
            {t('popup.clearHits')}
          </Button>
        </div>
      )}

      {hitSummaryStatus === 'error' && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">
          <p className="min-w-0 flex-1 text-xs font-medium">
            {t('popup.hitSummaryUnavailable')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => void loadRuleHitSummary()}
          >
            {t('popup.retry')}
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
                      /** 当前规则是否在本页面命中过。 */
                      const isMatched = hitRuleIdSet.has(rule.id);
                      /** 当前规则被浏览器拒绝的注册记录；存在时该规则并未真正生效。 */
                      const issue = dnrIssues[rule.id];
                      /** 右上角标记的说明文本，注册失败时改为说明规则未生效。 */
                      const markerLabel = issue
                        ? t('popup.ruleNotRegistered', { message: issue.message })
                        : t('popup.ruleMatched');
                      return (
                        <li
                          key={rule.id}
                          role="button"
                          tabIndex={0}
                          title={t('popup.jumpToRule')}
                          aria-label={t('popup.jumpToRule')}
                          onClick={() => handleJumpToRule(rule.id)}
                          onKeyDown={(event) => {
                            // 焦点在 Switch 等子控件上时按键交给它自己处理，避免误跳转
                            if (event.target !== event.currentTarget) {
                              return;
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleJumpToRule(rule.id);
                            }
                          }}
                          className={`relative flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                            isMatched
                              ? 'border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/20 hover:bg-primary/20'
                              : 'border-transparent hover:bg-muted/60'
                          }`}
                        >
                          {/*
                            右上角只有一个标记位：注册失败优先于命中占用它。
                            规则没注册成功就不可能有命中，两者不会同时出现；而「未生效」比
                            「没命中」信息量大得多——后者是前者的必然结果，不该抢占同一个位置。
                          */}
                          {(issue || isMatched) && (
                            <span
                              className={`absolute -right-1 -top-1 flex size-[18px] items-center justify-center rounded-full shadow-sm ${
                                issue
                                  ? 'bg-destructive text-destructive-foreground'
                                  : 'bg-primary text-primary-foreground'
                              }`}
                              title={markerLabel}
                              aria-label={markerLabel}
                            >
                              {issue ? <AlertTriangle className="size-3" /> : <Target className="size-3" />}
                            </span>
                          )}
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {/* 开关自成一体：拦下冒泡，避免切换启停时误触发整卡片的跳转 */}
                            <span
                              className="contents"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Switch
                                checked={rule.enabled}
                                onCheckedChange={() => handleToggleRule(rule.id)}
                              />
                            </span>
                            <span
                              className={`min-w-0 flex-1 truncate text-sm ${
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
