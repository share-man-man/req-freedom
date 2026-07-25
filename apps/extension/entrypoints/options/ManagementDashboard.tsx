import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FolderPlus, Languages, ListChecks, MoreHorizontal, Search, ToggleRight, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RuleExecutionChannel } from '@req-freedom/shared';
import { LogoMark } from '@/components/logo-mark';
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
import { changeLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@/utils/i18n';

/** 各受支持语言的自称展示名（用当前语言书写，不随界面语言翻译）。 */
const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
};

interface MoreMenuProps {
  /** 点击导入规则后的回调。 */
  onImport: () => void;
  /** 点击导出规则后的回调。 */
  onExport: () => void;
}

/**
 * 顶栏「更多」菜单：收纳导入 / 导出规则与界面语言切换等低频全局操作。
 *
 * 与 App.tsx 里 AddRuleMenu 一致的「点击外部 + Esc 收起」轻量气泡，经 Portal 挂到 body
 * 并以 fixed 定位，避免被顶栏自身的裁剪或层叠上下文影响。
 * @param props 导入 / 导出回调
 */
function MoreMenu({ onImport, onExport }: MoreMenuProps) {
  const { t, i18n } = useTranslation();
  /** 菜单是否展开。 */
  const [open, setOpen] = useState(false);
  /** 触发按钮的包裹节点，用于测量位置与判定点击外部。 */
  const triggerRef = useRef<HTMLDivElement>(null);
  /** 菜单节点，用于判定点击外部。 */
  const menuRef = useRef<HTMLDivElement>(null);
  /** 菜单相对视口的 fixed 定位坐标；null 表示尚未测量。 */
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  // 展开时按触发按钮位置计算菜单坐标，并在滚动 / 缩放时跟随；同时监听点击外部与 Esc 收起
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    /** 依据触发按钮的视口矩形更新菜单坐标（右对齐、下方 4px）。 */
    const updatePosition = (): void => {
      /** 触发按钮当前的视口矩形。 */
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      }
    };
    updatePosition();
    /** 点击触发按钮与菜单之外则收起。 */
    const onPointerDown = (event: PointerEvent): void => {
      /** 本次事件的目标节点。 */
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    /** 按 Esc 收起。 */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /**
   * 执行选中项回调并收起菜单。
   * @param action 选中项对应的回调
   */
  const choose = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div ref={triggerRef} className="shrink-0">
      <Button variant="outline" size="icon" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} title={t('dashboard.moreMenu.trigger')}>
        <MoreHorizontal />
      </Button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: position.top, right: position.right }}
          className="fixed z-50 max-h-[min(32rem,calc(100vh-1rem))] w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onImport)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <Upload className="size-4 text-muted-foreground" />
            {t('dashboard.header.import')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onExport)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <Download className="size-4 text-muted-foreground" />
            {t('dashboard.header.export')}
          </button>
          <div className="my-1 border-t border-border" />
          <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5"><Languages className="size-3.5" />{t('dashboard.moreMenu.language')}</span>
          </div>
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              aria-checked={i18n.language === locale}
              onClick={() => choose(() => void changeLocale(locale))}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <Check className={`size-3.5 shrink-0 ${i18n.language === locale ? 'text-primary' : 'text-transparent'}`} />
              {LOCALE_DISPLAY_NAMES[locale]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 规则状态筛选的统一取值。 */
export const RULE_STATUS_FILTER = {
  All: 'all',
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const;

/** 规则状态筛选的可选取值类型。 */
export type RuleStatusFilter = (typeof RULE_STATUS_FILTER)[keyof typeof RULE_STATUS_FILTER];

interface OptionsPageHeaderProps {
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
  onImport,
  onExport,
}: OptionsPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="aurora-badge flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-primary/20">
            <LogoMark className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{t('dashboard.header.title')}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{t('dashboard.header.subtitle')}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MoreMenu onImport={onImport} onExport={onExport} />
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
  const { t } = useTranslation();
  return (
    <section className="grid gap-4 md:grid-cols-3" aria-label={t('dashboard.statistics.ariaLabel')}>
      <StatisticCard
        icon={<FolderPlus className="size-6" />}
        iconClassName="bg-violet-500/15 text-[var(--accent-violet)]"
        label={t('dashboard.statistics.groupLabel')}
        value={groupCount}
        suffix={t('dashboard.statistics.groupSuffix')}
      />
      <StatisticCard
        icon={<ListChecks className="size-6" />}
        iconClassName="bg-indigo-500/15 text-[var(--accent-indigo)]"
        label={t('dashboard.statistics.ruleLabel')}
        value={ruleCount}
        suffix={t('dashboard.statistics.ruleSuffix')}
      />
      <StatisticCard
        icon={<ToggleRight className="size-6" />}
        iconClassName="bg-emerald-500/15 text-[var(--accent-emerald)]"
        label={t('dashboard.statistics.enabledLabel')}
        value={enabledRuleCount}
        suffix={t('dashboard.statistics.ruleSuffix')}
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
    <Card className="glow-surface border-border/80 shadow-sm">
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
  /** 执行通道筛选值，all 表示不过滤。 */
  channelFilter: RuleExecutionChannel | 'all';
  /** 执行通道筛选变化后的回调。 */
  onChannelFilterChange: (channel: RuleExecutionChannel | 'all') => void;
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
  channelFilter,
  onChannelFilterChange,
}: RuleManagementToolbarProps) {
  const { t } = useTranslation();
  return (
    <section className="glow-surface rounded-2xl border border-border/80 bg-card p-4 shadow-sm" aria-label={t('dashboard.toolbar.ariaLabel')}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9"
            placeholder={t('dashboard.toolbar.searchPlaceholder')}
            aria-label={t('dashboard.toolbar.searchAriaLabel')}
          />
        </label>
        <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as RuleStatusFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t('dashboard.toolbar.statusPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RULE_STATUS_FILTER.All}>{t('dashboard.toolbar.statusAll')}</SelectItem>
            <SelectItem value={RULE_STATUS_FILTER.Enabled}>{t('dashboard.toolbar.statusEnabled')}</SelectItem>
            <SelectItem value={RULE_STATUS_FILTER.Disabled}>{t('dashboard.toolbar.statusDisabled')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(value) => onChannelFilterChange(value as RuleExecutionChannel | 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('dashboard.toolbar.channelPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('dashboard.toolbar.channelAll')}</SelectItem>
            {Object.values(RuleExecutionChannel).map((channel) => (
              <SelectItem key={channel} value={channel}>
                {channel === RuleExecutionChannel.Dnr ? t('dashboard.toolbar.channelDnr') : t('dashboard.toolbar.channelPagePatch')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
