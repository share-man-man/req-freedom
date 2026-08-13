import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Settings2, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DnrRegistrationIssues, RuleGroup, RuleHitSummary } from '@req-freedom/shared';
import { RuleHitSkipReason } from '@req-freedom/shared';
import {
  RUNTIME_MSG_CLEAR_RULE_HITS,
  RUNTIME_MSG_GET_RULE_HIT_SUMMARY,
} from '@req-freedom/shared';
import { collectActiveRules } from '@req-freedom/core';
import { getLabels } from '@/utils/labels';
import {
  getDnrIssues,
  getEnabled,
  getGroups,
  saveGroups,
  setEnabled,
  setPendingRuleHighlight,
  watchDnrIssues,
  watchTabHitSummary,
} from '@/utils/storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverHint } from '@/components/ui/hover-hint';
import { Switch } from '@/components/ui/switch';
import { LogoMark } from '@/components/logo-mark';

/**
 * 判断分组在 popup 打开时是否应默认折叠。
 *
 * 整组停用、或组内规则全部停用时，展开的列表不会有任何生效项，默认收起把空间留给还在生效的分组；
 * 这只影响打开时的初始状态，用户之后的展开/折叠仍以手动操作为准。
 * @param group 待判断的规则分组
 * @returns 是否默认折叠
 */
function shouldCollapseByDefault(group: RuleGroup): boolean {
  return (
    group.rules.length > 0 && (!group.enabled || group.rules.every((rule) => !rule.enabled))
  );
}

/**
 * Popup 主界面：全局开关 + 按分组快速启停
 */
export default function App() {
  const { t } = useTranslation();
  /** 各枚举展示名映射。 */
  const labels = getLabels(t);
  /** 全局开关状态 */
  const [enabled, setEnabledState] = useState(true);
  /** 规则分组列表 */
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  /** 已折叠的分组 ID 集合，初值按 shouldCollapseByDefault 计算，仅保留在当前弹窗会话中 */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  /** 当前页面命中过的业务规则 ID，已按规则去重。 */
  const [hitRuleIds, setHitRuleIds] = useState<string[]>([]);
  /** 本页匹配上、但一次都没能应用的规则及其原因。 */
  const [skippedRuleIds, setSkippedRuleIds] = useState<Record<string, RuleHitSkipReason>>({});
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
      setSkippedRuleIds(summary.skippedRuleIds);
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

  // popup 打开期间页面仍在发请求，订阅命中镜像让展示随之更新，而不是停在打开那一刻
  useEffect(() => {
    if (activeTabId === null) {
      return undefined;
    }
    return watchTabHitSummary(activeTabId, (summary) => {
      setHitRuleIds(summary.ruleIds);
      setSkippedRuleIds(summary.skippedRuleIds);
      setHitsTruncated(summary.truncated);
    });
  }, [activeTabId]);

  // 初始加载 storage 中的开关与分组
  useEffect(() => {
    void (async () => {
      /** 并行读取配置，缩短 popup 首次渲染等待。 */
      const [nextEnabled, nextGroups] = await Promise.all([getEnabled(), getGroups()]);
      setEnabledState(nextEnabled);
      setGroups(nextGroups);
      setCollapsedGroupIds(
        new Set(nextGroups.filter(shouldCollapseByDefault).map((group) => group.id)),
      );
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
      setSkippedRuleIds({});
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
    // openOptionsPage 会复用已有配置页；session 请求让新页面和已打开页面都能完成定位。
    void setPendingRuleHighlight(ruleId).then(() => browser.runtime.openOptionsPage());
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
  /** 当前仍存在的规则 ID。 */
  const knownRuleIds = new Set(groups.flatMap((group) => group.rules.map((rule) => rule.id)));
  /**
   * 顶部计数只统计列表里还找得到的规则。
   *
   * 命中日志按规则 ID 记录，规则删除后它的命中仍留在日志里；照单全收会让顶部数字大于
   * 下方可见的标记数，而多出来的那几条没有任何行可以对应，用户无从解释差额。
   * 过滤后为零时整张卡片隐藏，与其他零命中的页面一视同仁——日志里残留什么是内部细节，
   * 不需要向用户解释。
   */
  const visibleHitCount = hitRuleIds.filter((ruleId) => knownRuleIds.has(ruleId)).length;


  return (
    <div className="flex flex-col">
      {/* 顶部：品牌 + 全局开关 */}
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <LogoMark className="size-3.5" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">ReqFreedom</h1>
            <p className="text-[11px] text-muted-foreground">
              {enabled ? t('popup.activeCount', { count: activeCount }) : t('popup.globallyDisabled')}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggleGlobal} />
      </header>

      {/* 当前页面命中提示：总数同时包含 DNR 与页面补丁通道。 */}
      {visibleHitCount > 0 && (
        <div className="mx-2 mt-2 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-primary">
          <CheckCircle2 className="mt-px size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-4">
              {t('popup.hitTotal', { count: visibleHitCount })}
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
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-destructive">
          <p className="min-w-0 flex-1 text-xs font-medium">
            {t('popup.hitSummaryUnavailable')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-xs"
            onClick={() => void loadRuleHitSummary()}
          >
            {t('popup.retry')}
          </Button>
        </div>
      )}

      {/* 分组列表 */}
      <div className="max-h-96 overflow-y-auto p-1.5">
        {!hasRules ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('popup.noRules')}</p>
            <p className="text-xs text-muted-foreground/70">{t('popup.noRulesHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-border">
                {/* 分组标题行：折叠控制 + 整组开关 */}
                <div className="flex items-center justify-between gap-2 px-1.5 py-1">
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
                  <Badge variant="muted" className="shrink-0 px-1.5 py-0 text-[11px]">
                    {t('popup.ruleCount', { count: group.rules.length })}
                  </Badge>
                </div>

                {/* 组内规则：整组停用时淡化 */}
                {!collapsedGroupIds.has(group.id) && group.rules.length > 0 && (
                  <ul
                    className={`flex flex-col border-t border-border p-1 ${
                      group.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    {group.rules.map((rule) => {
                      /** 当前规则是否在本页面命中过。 */
                      const isMatched = hitRuleIdSet.has(rule.id);
                      /** 当前规则被浏览器拒绝的注册记录；存在时该规则并未真正生效。 */
                      const issue = dnrIssues[rule.id];
                      /** 当前规则匹配上却一次都没能应用时的原因。 */
                      const skipReason = skippedRuleIds[rule.id];
                      /** 右侧状态位的说明文本；无状态可表达时为空。 */
                      const statusLabel = issue
                        ? t('popup.ruleNotRegistered', { message: issue.message })
                        : skipReason
                          ? t('popup.ruleSkipped', {
                              reason: labels.RULE_HIT_SKIP_REASON_LABELS[skipReason],
                            })
                          : isMatched
                            ? t('popup.ruleMatched')
                            : '';
                      return (
                        <li
                          key={rule.id}
                          role="button"
                          tabIndex={0}
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
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-1.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                            isMatched
                              ? 'bg-[var(--hit-surface)] hover:bg-[var(--hit-surface-hover)]'
                              : 'hover:bg-muted/60'
                          }`}
                        >
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
                            {/*
                              三种状态共用同一个状态位，只靠颜色与字形区分，彼此互斥：
                              注册失败只发生在 DNR 通道、未应用只发生在页面补丁通道，
                              而「生效过」优先于「未应用」已在摘要投影时决定。
                              行只补一层极淡的底色帮助扫读；描边、内环与浮起角标一并去掉——
                              四层装饰叠在一起，命中多条时整个列表会糊成一片。
                            */}
                            {statusLabel && (
                              // 说明文字走自绘气泡：原生 title 要悬停约一秒才出、样式不可控，
                              // 且会被行自身的 title 抢走，注册失败/未应用这类关键信息看不清楚
                              <span
                                className="contents"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <HoverHint
                                  label={statusLabel}
                                  content={statusLabel}
                                  className={`size-4 items-center justify-center ${
                                    issue
                                      ? 'text-destructive'
                                      : skipReason
                                        ? 'text-warning'
                                        : 'text-primary'
                                  }`}
                                >
                                  {issue ? (
                                    <AlertTriangle aria-hidden="true" className="size-3.5" />
                                  ) : skipReason ? (
                                    <CircleSlash aria-hidden="true" className="size-3.5" />
                                  ) : (
                                    <Target aria-hidden="true" className="size-3.5" />
                                  )}
                                </HoverHint>
                              </span>
                            )}
                            <Badge
                              variant={rule.enabled ? 'default' : 'muted'}
                              className="shrink-0 px-1.5 py-0 text-[11px]"
                            >
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
      <footer className="border-t border-border p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={handleOpenOptions}>
          <Settings2 />
          {t('popup.manageRules')}
        </Button>
      </footer>
    </div>
  );
}
