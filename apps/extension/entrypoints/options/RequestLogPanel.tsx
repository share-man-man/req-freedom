import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { ChevronLeft, CircleSlash, ListFilter, RotateCcw, ScrollText, Target, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuleGroup, RuleHit, RuleHitLog, RuleHitTabSummary } from '@req-freedom/shared';
import { LoadStatus, RuleActionType, RuleHitOutcome } from '@req-freedom/shared';
import { getLabels } from '@/utils/labels';
import { clearTabHits, fetchHitLog, fetchHitTabSummaries } from '@/utils/rule-hit-client';
import {
  countHitsByRule,
  EMPTY_HIT_LOG_FILTER,
  filterHits,
  groupHitsByLocalDate,
} from '@/utils/rule-hit-view';
import type { HitLogFilter } from '@/utils/rule-hit-view';
import { watchHitTabsChanged, watchTabHitLog } from '@/utils/storage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACTION_BADGE_CLASS } from './rule-badges';

/**
 * 下拉筛选中代表「不过滤」的取值。
 *
 * Radix Select 不接受空字符串作为选项值，因此用一个显式哨兵值表达「全部」。
 */
const FILTER_ALL = 'all';

/**
 * 日志表格「表头」与「数据行」共用的网格列模板，保证列对齐。
 *
 * 列依次为：时间 · 方法 · 请求 URL · 命中规则 · 动作 · 执行结果。
 */
const LOG_ROW_GRID =
  'grid grid-cols-[104px_64px_minmax(0,1.6fr)_minmax(0,1fr)_120px_128px] items-center gap-3';

/** 一个仍然打开着的标签页，用于把命中日志里的标签页 ID 还原成可读名称。 */
interface LiveTab {
  /** 标签页 ID。 */
  id: number;
  /** 标签页标题；标题为空时回退到 URL，都没有则为空串。 */
  label: string;
}

/** 由当前规则表还原出的规则展示信息。 */
interface RuleDisplayInfo {
  /** 规则名称。 */
  name: string;
  /** 规则所属分组名称。 */
  groupName: string;
}

interface RequestLogPanelProps {
  /** 当前全部规则分组，用于把命中记录里的规则 ID 还原成规则名。 */
  groups: RuleGroup[];
  /** 返回规则管理视图。 */
  onBack: () => void;
  /** 点击命中记录中的规则名后跳转定位到该规则。 */
  onJumpToRule: (ruleId: string) => void;
}

/**
 * 把命中时间格式化为固定的 24 小时制「时:分:秒」与毫秒两段。
 *
 * 刻意不用 toLocaleTimeString：各语言下会拿到 AM/PM、「午後 6:03:07」这类长度不一的写法，
 * 逐行扫读时对不齐；而这一列的用途是比对先后顺序，固定两位数字最省眼力。完整日期时间放在
 * 悬停提示里，需要时再看。
 * @param at 命中记录的时间戳
 * @returns 分成时钟与毫秒两段的时间文本
 */
function formatHitTime(at: number): { clock: string; millis: string } {
  /** 命中时刻。 */
  const date = new Date(at);
  /** 时、分、秒三段补零后的数字。 */
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return { clock, millis: String(date.getMilliseconds()).padStart(3, '0') };
}

/**
 * 请求日志面板：逐条展示「哪条规则命中了哪个请求」。
 *
 * 数据源是 background 的命中日志：初次读取走消息拿内存里的权威数据，随后订阅
 * storage.session 镜像跟随页面的新请求刷新（约 1 秒一次）。日志按标签页归档，
 * 因此面板要先选一个标签页。
 * @param props 规则数据、深链标签页与跳转回调
 */
export default function RequestLogPanel({
  groups,
  onBack,
  onJumpToRule,
}: RequestLogPanelProps) {
  const { t, i18n } = useTranslation();
  /** background 内存中仍有命中日志的标签页，按最近活跃排序。 */
  const [tabSummaries, setTabSummaries] = useState<RuleHitTabSummary[]>([]);
  /** 当前仍然打开着的标签页，用于取标题并判断选中的标签页是否已关闭。 */
  const [liveTabs, setLiveTabs] = useState<LiveTab[]>([]);
  /** 当前查看的标签页；null 表示尚未选中。 */
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null);
  /** 当前标签页的完整命中日志。 */
  const [log, setLog] = useState<RuleHitLog>({ hits: [], truncated: false });
  /** 视图筛选条件。 */
  const [filter, setFilter] = useState<HitLogFilter>(EMPTY_HIT_LOG_FILTER);
  /** 数据加载状态，用于区分「没有命中」与「读不到数据」。 */
  const [status, setStatus] = useState<LoadStatus>(LoadStatus.Loading);

  /** 各枚举展示名映射。 */
  const labels = getLabels(t);

  /**
   * 读取仍有命中日志的标签页，并同步一份当前打开的标签页快照。
   *
   * 标题来自浏览器实时查询而非日志：标签页标题随时会变，存进日志只会过期。
   */
  const loadTabs = useCallback(async (): Promise<void> => {
    try {
      /** background 内存中仍保有日志的标签页与当前打开的标签页。 */
      const [summaries, tabs] = await Promise.all([fetchHitTabSummaries(), browser.tabs.query({})]);
      if (!summaries) {
        setStatus(LoadStatus.Error);
        return;
      }
      setTabSummaries(summaries);
      setLiveTabs(
        tabs.flatMap((tab) => (tab.id === undefined ? [] : [{ id: tab.id, label: tab.title || tab.url || '' }])),
      );
      setStatus(LoadStatus.Ready);
    } catch {
      setStatus(LoadStatus.Error);
    }
  }, []);

  /**
   * 读取指定标签页的完整命中日志。
   * @param tabId 目标标签页
   */
  const loadLog = useCallback(async (tabId: number): Promise<void> => {
    try {
      /** background 内存中的权威日志。 */
      const nextLog = await fetchHitLog(tabId);
      if (!nextLog) {
        setStatus(LoadStatus.Error);
        return;
      }
      setLog(nextLog);
      setStatus(LoadStatus.Ready);
    } catch {
      setStatus(LoadStatus.Error);
    }
  }, []);

  // 首次进入读取标签页列表，并订阅命中镜像：任一标签页有新命中时刷新条数与排序
  useEffect(() => {
    void loadTabs();
    return watchHitTabsChanged(() => void loadTabs());
  }, [loadTabs]);

  /**
   * 标签页选择器的选项。
   *
   * 除了「有命中日志的标签页」，还要补上当前选中的标签页——只要它还开着。否则清空日志会让
   * 当前标签页从列表里消失，用户刚点完「清空」就被甩到另一个标签页上。已关闭的标签页不补：
   * 它的日志已被回收，留在列表里只会展示一片空白。
   */
  const tabOptions = useMemo(() => {
    /** 仍然打开着的标签页 ID 到展示名的映射。 */
    const labelByTabId = new Map(liveTabs.map((tab) => [tab.id, tab.label]));
    /** 当前选中但已无命中记录、仍需保留在列表里的标签页。 */
    const pinnedTabIds =
      selectedTabId !== null &&
      labelByTabId.has(selectedTabId) &&
      !tabSummaries.some((summary) => summary.tabId === selectedTabId)
        ? [selectedTabId]
        : [];
    return [
      ...tabSummaries,
      ...pinnedTabIds.map((tabId) => ({ tabId, total: 0, lastHitAt: 0 })),
    ].map((summary) => ({
      ...summary,
      label:
        labelByTabId.get(summary.tabId) || t('requestLog.tabFallback', { tabId: summary.tabId }),
    }));
  }, [liveTabs, selectedTabId, t, tabSummaries]);

  // 尚未选中标签页时落到最近活跃的那个；选中的标签页被关闭后同样重新落位
  useEffect(() => {
    if (tabOptions.length === 0) {
      return;
    }
    if (selectedTabId === null || !tabOptions.some((option) => option.tabId === selectedTabId)) {
      setSelectedTabId(tabOptions[0].tabId);
    }
  }, [selectedTabId, tabOptions]);

  // 切换标签页后读取一次日志，并订阅该标签页镜像跟随新请求刷新
  useEffect(() => {
    if (selectedTabId === null) {
      return undefined;
    }
    setLog({ hits: [], truncated: false });
    void loadLog(selectedTabId);
    return watchTabHitLog(selectedTabId, setLog);
  }, [loadLog, selectedTabId]);

  /**
   * 清空当前标签页的命中日志。
   *
   * 清空不可撤销，且日志只存在于内存与 session 镜像里，删掉就再也拿不回来，因此先二次确认。
   */
  const handleClear = async (): Promise<void> => {
    if (selectedTabId === null) {
      return;
    }
    if (!window.confirm(t('requestLog.clearConfirm', { count: log.hits.length }))) {
      return;
    }
    try {
      await clearTabHits(selectedTabId);
      setLog({ hits: [], truncated: false });
      await loadTabs();
    } catch {
      setStatus(LoadStatus.Error);
    }
  };

  /** 规则 ID 到展示信息的映射；命中日志只存 ID，规则名要现查。 */
  const ruleInfoById = useMemo(() => {
    /** 当前规则表投影出的展示信息。 */
    const infoById = new Map<string, RuleDisplayInfo>();
    for (const group of groups) {
      for (const rule of group.rules) {
        infoById.set(rule.id, { name: rule.name, groupName: group.name });
      }
    }
    return infoById;
  }, [groups]);

  /** 供关键词搜索使用的规则名映射。 */
  const ruleNameById = useMemo(
    () => Object.fromEntries([...ruleInfoById].map(([ruleId, info]) => [ruleId, info.name])),
    [ruleInfoById],
  );

  /** 逐规则命中统计，按次数倒序。 */
  const ruleCounts = useMemo(() => countHitsByRule(log.hits), [log.hits]);

  /** 通过筛选条件、并按时间倒序（最新在最前）排列的命中记录。 */
  const visibleHits = useMemo(
    () => filterHits(log.hits, filter, ruleNameById).reverse(),
    [filter, log.hits, ruleNameById],
  );

  /** 按本地自然日分组后的可见命中记录。 */
  const visibleHitGroups = useMemo(
    () => groupHitsByLocalDate(visibleHits, i18n.language),
    [i18n.language, visibleHits],
  );

  /**
   * 激活当前日志所属的标签页；标签页已关闭时刷新选择器并保持当前页面。
   */
  const handleOpenSelectedTab = useCallback(async (): Promise<void> => {
    if (selectedTabId === null) {
      return;
    }
    try {
      /** 点击发生时重新查询，避免使用已经过期的标签页快照。 */
      const targetTab = await browser.tabs.get(selectedTabId);
      await browser.tabs.update(selectedTabId, { active: true });
      await browser.windows.update(targetTab.windowId, { focused: true });
    } catch {
      await loadTabs();
    }
  }, [loadTabs, selectedTabId]);

  /** 当前日志所属的标签页是否仍在浏览器中打开。 */
  const isSelectedTabAlive =
    selectedTabId !== null && liveTabs.some((tab) => tab.id === selectedTabId);

  /** 当前是否设置了任意筛选条件。 */
  const hasFilter =
    filter.keyword.trim() !== '' ||
    filter.ruleId !== null ||
    filter.action !== null ||
    filter.outcome !== null;

  return (
    <section className="space-y-4" aria-label={t('requestLog.title')}>
      {/* 视图标题：日志是从「更多」菜单进来的独立视图，需要一条明确的回程 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft />
          {t('requestLog.backToRules')}
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">{t('requestLog.title')}</h2>
      </div>

      {/* 工具栏：选择标签页 + 三个维度的筛选 + 清空 */}
      <div className="glow-surface rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={selectedTabId === null ? '' : String(selectedTabId)}
            onValueChange={(value) => setSelectedTabId(Number(value))}
          >
            <SelectTrigger className="w-72" aria-label={t('requestLog.tabSelectorLabel')}>
              <SelectValue placeholder={t('requestLog.tabSelectorPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {tabOptions.map((option) => (
                <SelectItem key={option.tabId} value={String(option.tabId)}>
                  {t('requestLog.tabOption', { label: option.label, count: option.total })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="relative min-w-56 flex-1">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.keyword}
              onChange={(event) =>
                setFilter((previous) => ({ ...previous, keyword: event.target.value }))
              }
              className="pl-9"
              placeholder={t('requestLog.searchPlaceholder')}
              aria-label={t('requestLog.searchPlaceholder')}
            />
          </label>
          <Select
            value={filter.action ?? FILTER_ALL}
            onValueChange={(value) =>
              setFilter((previous) => ({
                ...previous,
                action: value === FILTER_ALL ? null : (value as RuleActionType),
              }))
            }
          >
            <SelectTrigger className="w-40" aria-label={t('requestLog.actionFilterLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>{t('requestLog.actionAll')}</SelectItem>
              {Object.values(RuleActionType).map((action) => (
                <SelectItem key={action} value={action}>
                  {labels.RULE_ACTION_TYPE_LABELS[action]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.outcome ?? FILTER_ALL}
            onValueChange={(value) =>
              setFilter((previous) => ({
                ...previous,
                outcome: value === FILTER_ALL ? null : (value as RuleHitOutcome),
              }))
            }
          >
            <SelectTrigger className="w-36" aria-label={t('requestLog.outcomeFilterLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>{t('requestLog.outcomeAll')}</SelectItem>
              <SelectItem value={RuleHitOutcome.Applied}>
                {t('requestLog.outcomeApplied')}
              </SelectItem>
              <SelectItem value={RuleHitOutcome.Skipped}>
                {t('requestLog.outcomeSkipped')}
              </SelectItem>
            </SelectContent>
          </Select>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={() => setFilter(EMPTY_HIT_LOG_FILTER)}>
              <RotateCcw />
              {t('requestLog.resetFilter')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={selectedTabId === null || log.hits.length === 0}
            onClick={() => void handleClear()}
          >
            <Trash2 />
            {t('requestLog.clear')}
          </Button>
        </div>

        {/* 逐规则统计：先看「哪条规则命中得最多」，点击即下钻到该规则的记录 */}
        {ruleCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-xs text-muted-foreground">{t('requestLog.statsLabel')}</span>
            {ruleCounts.map((count) => (
              <button
                key={count.ruleId}
                type="button"
                aria-pressed={filter.ruleId === count.ruleId}
                onClick={() =>
                  setFilter((previous) => ({
                    ...previous,
                    ruleId: previous.ruleId === count.ruleId ? null : count.ruleId,
                  }))
                }
                title={
                  count.applied === count.total
                    ? undefined
                    : t('requestLog.appliedOf', { applied: count.applied, total: count.total })
                }
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  filter.ruleId === count.ruleId
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/80 text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="max-w-40 truncate">
                  {ruleInfoById.get(count.ruleId)?.name ?? t('requestLog.deletedRule')}
                </span>
                <span className="font-mono">{count.total}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {status === LoadStatus.Error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="min-w-0 flex-1">{t('requestLog.loadFailed')}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void loadTabs();
              if (selectedTabId !== null) {
                void loadLog(selectedTabId);
              }
            }}
          >
            {t('requestLog.retry')}
          </Button>
        </div>
      )}

      {log.truncated && (
        <p className="rounded-xl border border-border/80 bg-card px-4 py-3 text-xs text-muted-foreground">
          {t('requestLog.truncated')}
        </p>
      )}

      {/* 命中记录列表 */}
      {status === LoadStatus.Loading ? (
        // 首屏两次异步读取都还没回来，此时空状态是误导：还没查完，不是真的没有命中
        <p className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          {t('requestLog.loading')}
        </p>
      ) : tabOptions.length === 0 ? (
        <EmptyState
          title={t('requestLog.emptyNoTabs')}
          hint={t('requestLog.emptyNoTabsHint')}
        />
      ) : visibleHits.length === 0 ? (
        <EmptyState
          title={hasFilter ? t('requestLog.emptyFiltered') : t('requestLog.emptyTab')}
          hint={hasFilter ? t('requestLog.emptyFilteredHint') : t('requestLog.emptyTabHint')}
        />
      ) : (
        <div className="glow-surface overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <div
            className={`${LOG_ROW_GRID} border-b border-border/80 px-4 py-2.5 text-xs font-medium text-muted-foreground`}
          >
            <span>{t('requestLog.columnTime')}</span>
            <span>{t('requestLog.columnMethod')}</span>
            <span>{t('requestLog.columnUrl')}</span>
            <span>{t('requestLog.columnRule')}</span>
            <span>{t('requestLog.columnAction')}</span>
            <span>{t('requestLog.columnOutcome')}</span>
          </div>
          <div>
            {visibleHitGroups.map((group) => (
              <section key={group.key} aria-labelledby={`request-log-date-${group.key}`}>
                <h3
                  id={`request-log-date-${group.key}`}
                  className="border-b border-border/70 bg-muted/35 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  {group.label}
                </h3>
                <ul className="divide-y divide-border/60">
                  {group.hits.map((hit, index) => (
                    <HitRow
                      // 同一请求的同一动作可能重复命中，时间戳不足以唯一标识，补上序号
                      key={`${hit.at}-${hit.ruleId}-${hit.action}-${index}`}
                      hit={hit}
                      ruleInfo={ruleInfoById.get(hit.ruleId)}
                      actionLabel={labels.RULE_ACTION_TYPE_LABELS[hit.action]}
                      skipReasonLabels={labels.RULE_HIT_SKIP_REASON_LABELS}
                      locale={i18n.language}
                      canOpenTab={isSelectedTabAlive}
                      onOpenTab={() => void handleOpenSelectedTab()}
                      onJumpToRule={onJumpToRule}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface EmptyStateProps {
  /** 主标题。 */
  title: string;
  /** 补充说明。 */
  hint: string;
}

/**
 * 日志列表的空状态卡片。
 * @param props 标题与说明文案
 */
function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ScrollText className="size-6" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

interface HitRowProps {
  /** 一条命中记录。 */
  hit: RuleHit;
  /** 命中规则的展示信息；规则已被删除时为空。 */
  ruleInfo: RuleDisplayInfo | undefined;
  /** 动作类型的展示名。 */
  actionLabel: string;
  /** 各跳过原因的展示名。 */
  skipReasonLabels: ReturnType<typeof getLabels>['RULE_HIT_SKIP_REASON_LABELS'];
  /** 当前界面语言，用于生成完整日期时间的悬停提示。 */
  locale: string;
  /** 当前日志所属的标签页是否仍然存活。 */
  canOpenTab: boolean;
  /** 激活当前日志所属标签页的回调。 */
  onOpenTab: () => void;
  /** 点击规则名后的跳转回调。 */
  onJumpToRule: (ruleId: string) => void;
}

/**
 * 单条命中记录行。
 * @param props 命中记录与其展示所需的补充信息
 */
function HitRow({
  hit,
  ruleInfo,
  actionLabel,
  skipReasonLabels,
  locale,
  canOpenTab,
  onOpenTab,
  onJumpToRule,
}: HitRowProps) {
  const { t } = useTranslation();
  /** 拆成时钟与毫秒两段的命中时间。 */
  const { clock, millis } = formatHitTime(hit.at);
  return (
    <li
      role={canOpenTab ? 'button' : undefined}
      tabIndex={canOpenTab ? 0 : undefined}
      title={canOpenTab ? t('requestLog.openTab') : undefined}
      aria-label={canOpenTab ? t('requestLog.openTab') : undefined}
      onClick={canOpenTab ? onOpenTab : undefined}
      onKeyDown={
        canOpenTab
          ? (event) => {
              if (event.target !== event.currentTarget) {
                return;
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenTab();
              }
            }
          : undefined
      }
      className={`${LOG_ROW_GRID} px-4 py-2 text-sm transition-colors ${
        canOpenTab
          ? 'cursor-pointer hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
          : 'hover:bg-muted/40'
      }`}
    >
      {/* 毫秒压暗一档：需要时看得到，扫读时不抢「时:分:秒」的位置 */}
      <span
        className="font-mono text-xs tabular-nums text-muted-foreground"
        title={new Date(hit.at).toLocaleString(locale)}
      >
        {clock}
        <span className="text-muted-foreground/60">.{millis}</span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">{hit.method}</span>
      <span className="min-w-0 truncate font-mono text-xs" title={hit.url}>
        {hit.url}
      </span>
      {ruleInfo ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onJumpToRule(hit.ruleId);
          }}
          title={t('requestLog.jumpToRule', { groupName: ruleInfo.groupName })}
          className="min-w-0 truncate text-left text-sm text-primary hover:underline"
        >
          {ruleInfo.name}
        </button>
      ) : (
        <span className="min-w-0 truncate text-sm text-muted-foreground" title={hit.ruleId}>
          {t('requestLog.deletedRule')}
        </span>
      )}
      <Badge variant="secondary" className={`w-fit border-transparent ${ACTION_BADGE_CLASS[hit.action]}`}>
        {actionLabel}
      </Badge>
      {hit.outcome === RuleHitOutcome.Applied ? (
        <span className="flex items-center gap-1 text-xs text-primary">
          <Target className="size-3.5 shrink-0" />
          {t('requestLog.outcomeApplied')}
        </span>
      ) : (
        <span
          className="flex items-center gap-1 text-xs text-warning"
          title={skipReasonLabels[hit.reason]}
        >
          <CircleSlash className="size-3.5 shrink-0" />
          <span className="truncate">{t('requestLog.outcomeSkipped')}</span>
        </span>
      )}
    </li>
  );
}
