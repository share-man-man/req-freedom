import { Download, FolderPlus, ListChecks, Search, ToggleRight, Upload, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { RuleType } from '@req-freedom/shared';
import { RULE_TYPE_LABELS } from '@/utils/labels';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** 规则状态筛选的统一取值。 */
export const RULE_STATUS_FILTER = {
  All: 'all',
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const;

/** 规则状态筛选的可选取值类型。 */
export type RuleStatusFilter = (typeof RULE_STATUS_FILTER)[keyof typeof RULE_STATUS_FILTER];

/** 分组视图切换的统一取值。 */
export const GROUP_VIEW = {
  All: 'all',
  Enabled: 'enabled',
  RecentlyUpdated: 'recent',
} as const;

/** 分组视图切换的可选取值类型。 */
export type GroupView = (typeof GROUP_VIEW)[keyof typeof GROUP_VIEW];

/** 分组排序方式的统一取值。 */
export const GROUP_SORT = {
  UpdatedAt: 'updated-at',
  Name: 'name',
} as const;

/** 分组排序方式的可选取值类型。 */
export type GroupSort = (typeof GROUP_SORT)[keyof typeof GROUP_SORT];

interface OptionsPageHeaderProps {
  /** 是否展示顶栏的新建分组按钮。 */
  showAddGroup: boolean;
  /** 点击新建分组后的回调。 */
  onAddGroup: () => void;
  /** 点击导入规则后的回调。 */
  onImport: () => void;
  /** 点击导出规则后的回调。 */
  onExport: () => void;
}

/**
 * 规则管理页顶栏：产品标识与全局配置操作。
 * @param props 顶栏交互回调
 */
export function OptionsPageHeader({
  showAddGroup,
  onAddGroup,
  onImport,
  onExport,
}: OptionsPageHeaderProps) {
  return (
    <header className="border-b border-border/80 bg-background/95">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
            <Zap className="size-6" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">Req Freedom 规则管理</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              拦截 · 重定向 · 参数注入 · Header · Mock · 延迟 · 脚本注入
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onImport}>
            <Upload />
            导入规则
          </Button>
          <Button variant="outline" onClick={onExport}>
            <Download />
            导出规则
          </Button>
          {showAddGroup && (
            <Button onClick={onAddGroup}>
              <FolderPlus />
              新建分组
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

interface ManagementStatisticsProps {
  /** 当前分组数量。 */
  groupCount: number;
  /** 当前规则总数。 */
  ruleCount: number;
  /** 当前有效规则数量。 */
  enabledRuleCount: number;
}

/**
 * 工作台的规则统计卡片。
 * @param props 各类规则数量
 */
export function ManagementStatistics({
  groupCount,
  ruleCount,
  enabledRuleCount,
}: ManagementStatisticsProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3" aria-label="规则统计">
      <StatisticCard
        icon={<FolderPlus className="size-6" />}
        iconClassName="bg-violet-500/10 text-violet-600"
        label="分组"
        value={groupCount}
        suffix="个分组"
      />
      <StatisticCard
        icon={<ListChecks className="size-6" />}
        iconClassName="bg-primary/10 text-primary"
        label="规则"
        value={ruleCount}
        suffix="条规则"
      />
      <StatisticCard
        icon={<ToggleRight className="size-6" />}
        iconClassName="bg-success/10 text-success"
        label="已启用"
        value={enabledRuleCount}
        suffix="条规则"
      />
    </section>
  );
}

interface StatisticCardProps {
  /** 卡片图标。 */
  icon: ReactNode;
  /** 图标容器的额外样式。 */
  iconClassName: string;
  /** 数据名称。 */
  label: string;
  /** 数据数值。 */
  value: number;
  /** 数值后的单位。 */
  suffix: string;
}

/**
 * 单项统计卡片。
 * @param props 图标、名称、数值与单位
 */
function StatisticCard({ icon, iconClassName, label, value, suffix }: StatisticCardProps) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <span className={`flex size-11 items-center justify-center rounded-xl ${iconClassName}`}>
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold leading-none tracking-tight">
            {value}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{suffix}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

interface RuleManagementToolbarProps {
  /** 搜索输入值。 */
  searchQuery: string;
  /** 搜索输入变化后的回调。 */
  onSearchQueryChange: (query: string) => void;
  /** 状态筛选值。 */
  statusFilter: RuleStatusFilter;
  /** 状态筛选变化后的回调。 */
  onStatusFilterChange: (status: RuleStatusFilter) => void;
  /** 规则类型筛选值，all 表示不过滤。 */
  typeFilter: RuleType | 'all';
  /** 规则类型筛选变化后的回调。 */
  onTypeFilterChange: (type: RuleType | 'all') => void;
  /** 分组排序方式。 */
  sort: GroupSort;
  /** 分组排序变化后的回调。 */
  onSortChange: (sort: GroupSort) => void;
  /** 当前激活的分组视图。 */
  view: GroupView;
  /** 分组视图切换后的回调。 */
  onViewChange: (view: GroupView) => void;
}

/**
 * 规则搜索、筛选与分组视图工具栏。
 * @param props 派生视图状态与更新回调
 */
export function RuleManagementToolbar({
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  view,
  onViewChange,
}: RuleManagementToolbarProps) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm" aria-label="规则筛选">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9"
            placeholder="搜索分组或规则名称、匹配内容…"
            aria-label="搜索分组或规则"
          />
        </label>
        <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as RuleStatusFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RULE_STATUS_FILTER.All}>状态：全部</SelectItem>
            <SelectItem value={RULE_STATUS_FILTER.Enabled}>状态：已启用</SelectItem>
            <SelectItem value={RULE_STATUS_FILTER.Disabled}>状态：已停用</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(value) => onTypeFilterChange(value as RuleType | 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">类型：全部</SelectItem>
            {Object.values(RuleType).map((type) => (
              <SelectItem key={type} value={type}>
                {RULE_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => onSortChange(value as GroupSort)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GROUP_SORT.UpdatedAt}>排序：最近更新</SelectItem>
            <SelectItem value={GROUP_SORT.Name}>排序：名称</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex overflow-hidden rounded-md border border-border" role="group" aria-label="分组视图">
          <ViewButton active={view === GROUP_VIEW.All} onClick={() => onViewChange(GROUP_VIEW.All)}>
            全部分组
          </ViewButton>
          <ViewButton active={view === GROUP_VIEW.Enabled} onClick={() => onViewChange(GROUP_VIEW.Enabled)}>
            仅启用
          </ViewButton>
          <ViewButton active={view === GROUP_VIEW.RecentlyUpdated} onClick={() => onViewChange(GROUP_VIEW.RecentlyUpdated)}>
            最近修改
          </ViewButton>
        </div>
      </div>
    </section>
  );
}

interface ViewButtonProps {
  /** 当前按钮是否为选中状态。 */
  active: boolean;
  /** 点击后的视图切换回调。 */
  onClick: () => void;
  /** 按钮文本。 */
  children: ReactNode;
}

/**
 * 工具栏中的分组视图切换按钮。
 * @param props 选中状态、点击回调与文案
 */
function ViewButton({ active, onClick, children }: ViewButtonProps) {
  return (
    <button
      type="button"
      className={`h-9 px-3 text-sm font-medium transition-colors ${
        active ? 'bg-primary/10 text-primary shadow-inner' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
