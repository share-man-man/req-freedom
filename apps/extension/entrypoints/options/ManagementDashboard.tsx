import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Download, FolderPlus, Info, Languages, ListChecks, Monitor, Moon, MoreHorizontal, Redo2, ScrollText, Search, Sun, ToggleRight, Undo2, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { RuleExecutionChannel, ThemeMode } from '@req-freedom/shared';
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
import { Switch } from '@/components/ui/switch';
import { changeLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@/utils/i18n';
import { getThemeMode, setTheme } from '@/utils/theme';

/** GitHub Pages 上的在线文档站地址，「关于」菜单项指向这里。 */
const DOCS_SITE_URL = 'https://share-man-man.github.io/req-freedom/';

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

/** 主题模式切换入口的图标。 */
const THEME_MODE_ICON: Record<ThemeMode, typeof Sun> = {
  [ThemeMode.System]: Monitor,
  [ThemeMode.Light]: Sun,
  [ThemeMode.Dark]: Moon,
};

/** 各主题模式对应的本地化文案键。 */
const THEME_MODE_LABEL_KEY: Record<ThemeMode, string> = {
  [ThemeMode.System]: 'dashboard.header.themeSystem',
  [ThemeMode.Light]: 'dashboard.header.themeLight',
  [ThemeMode.Dark]: 'dashboard.header.themeDark',
};

/**
 * 顶栏「更多」菜单：收纳导入 / 导出规则与界面语言切换等低频全局操作。
 *
 * 与 App.tsx 里 AddRuleMenu 一致的「点击外部 + Esc 收起」轻量气泡，经 Portal 挂到 body
 * 并以 fixed 定位，避免被顶栏自身的裁剪或层叠上下文影响。
 * @param props 导入 / 导出回调
 */
function MoreMenu({
  onImport,
  onExport,
}: MoreMenuProps) {
  const { t, i18n } = useTranslation();
  /** 菜单是否展开。 */
  const [open, setOpen] = useState(false);
  /** 语言二级菜单是否展开。 */
  const [languageOpen, setLanguageOpen] = useState(false);
  /** 主题二级菜单是否展开。 */
  const [themeOpen, setThemeOpen] = useState(false);
  /** 当前已生效的主题偏好。 */
  const [theme, setThemeState] = useState<ThemeMode>(() => getThemeMode());
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
      setLanguageOpen(false);
      setThemeOpen(false);
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

  /**
   * 保存主题偏好并关闭菜单。
   * @param nextTheme 用户选中的主题模式
   */
  const chooseTheme = (nextTheme: ThemeMode): void => {
    setThemeState(nextTheme);
    choose(() => void setTheme(nextTheme));
  };

  /** 在新标签页打开在线文档站，并收起菜单。 */
  const openDocs = (): void => {
    choose(() => void browser.tabs.create({ url: DOCS_SITE_URL }));
  };

  /** 当前主题对应的菜单图标。 */
  const ThemeIcon = THEME_MODE_ICON[theme];

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
          className="fixed z-50 w-56 overflow-visible rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
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
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={languageOpen}
              onClick={() => {
                setLanguageOpen((value) => !value);
                setThemeOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <Languages className="size-4 text-muted-foreground" />
              <span className="flex-1">{t('dashboard.moreMenu.language')}</span>
              <span className="text-xs text-muted-foreground">{LOCALE_DISPLAY_NAMES[i18n.language as SupportedLocale]}</span>
              <ChevronLeft className="size-3.5 text-muted-foreground" />
            </button>
            {languageOpen && (
              <div
                role="menu"
                aria-label={t('dashboard.moreMenu.language')}
                className="absolute right-[calc(100%+0.5rem)] top-0 z-10 max-h-[min(20rem,calc(100vh-1rem))] w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
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
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={themeOpen}
              onClick={() => {
                setThemeOpen((value) => !value);
                setLanguageOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <ThemeIcon className="size-4 text-muted-foreground" />
              <span className="flex-1">{t('dashboard.header.theme')}</span>
              <span className="text-xs text-muted-foreground">{t(THEME_MODE_LABEL_KEY[theme])}</span>
              <ChevronLeft className="size-3.5 text-muted-foreground" />
            </button>
            {themeOpen && (
              <div
                role="menu"
                aria-label={t('dashboard.header.theme')}
                className="absolute right-[calc(100%+0.5rem)] top-0 z-10 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {[ThemeMode.System, ThemeMode.Light, ThemeMode.Dark].map((mode) => {
                  /** 当前主题选项对应的图标。 */
                  const ModeIcon = THEME_MODE_ICON[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={theme === mode}
                      onClick={() => chooseTheme(mode)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <Check className={`size-3.5 shrink-0 ${theme === mode ? 'text-primary' : 'text-transparent'}`} />
                      <ModeIcon className="size-4 text-muted-foreground" />
                      {t(THEME_MODE_LABEL_KEY[mode])}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={openDocs}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <Info className="size-4 text-muted-foreground" />
            {t('dashboard.moreMenu.about')}
          </button>
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

/** 规则管理页的两个主视图。 */
export const OPTIONS_VIEW = {
  /** 规则与分组管理。 */
  Rules: 'rules',
  /** 请求日志（逐条命中记录）。 */
  Logs: 'logs',
} as const;

/** 规则管理页主视图的可选取值类型。 */
export type OptionsView = (typeof OPTIONS_VIEW)[keyof typeof OPTIONS_VIEW];

interface OptionsPageHeaderProps {
  /** 全局开关状态，与 popup 顶部的开关同源。 */
  enabled: boolean;
  /** 切换全局开关后的回调。 */
  onToggleEnabled: (next: boolean) => void;
  /** 当前是否可以撤销。 */
  canUndo: boolean;
  /** 当前是否可以重做。 */
  canRedo: boolean;
  /** 即将撤销的操作名称。 */
  undoLabel: string | null;
  /** 即将重做的操作名称。 */
  redoLabel: string | null;
  /** 点击撤销后的回调。 */
  onUndo: () => void;
  /** 点击重做后的回调。 */
  onRedo: () => void;
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
  enabled,
  onToggleEnabled,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
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
          <div className="flex items-center rounded-lg border border-border/70 bg-card/60 p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label={t('dashboard.header.undo')}
              title={undoLabel ? `${t('dashboard.header.undo')}：${undoLabel}` : t('dashboard.header.undo')}
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label={t('dashboard.header.redo')}
              title={redoLabel ? `${t('dashboard.header.redo')}：${redoLabel}` : t('dashboard.header.redo')}
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
          {/* 全局开关与 popup 顶部同源：停用时下方所有规则都不生效，用红色状态文案强调 */}
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5">
            <span
              className={`text-xs font-medium ${
                enabled ? 'text-muted-foreground' : 'text-destructive'
              }`}
            >
              {enabled
                ? t('dashboard.header.globalEnabled')
                : t('dashboard.header.globalDisabled')}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              aria-label={t('dashboard.header.globalToggle')}
            />
          </div>
          <MoreMenu
            onImport={onImport}
            onExport={onExport}
          />
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
  /** 各标签页合计的命中记录条数。 */
  hitRecordCount: number;
  /** 点击命中记录卡片后打开请求日志。 */
  onOpenRequestLog: () => void;
}

/**
 * 工作台的规则统计卡片。
 * @param props 各类规则数量与请求日志入口
 */
export function ManagementStatistics({
  groupCount,
  ruleCount,
  enabledRuleCount,
  hitRecordCount,
  onOpenRequestLog,
}: ManagementStatisticsProps) {
  const { t } = useTranslation();
  return (
    <section
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      aria-label={t('dashboard.statistics.ariaLabel')}
    >
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
      {/*
        命中记录既是统计的一项，也是请求日志的入口：规则配好之后，用户下一步要看的就是
        「到底命中了没有」，把入口放在这个数字上比藏进「更多」菜单更顺手。
      */}
      <StatisticCard
        icon={<ScrollText className="size-6" />}
        iconClassName="bg-cyan-500/15 text-[var(--accent-cyan)]"
        label={t('dashboard.statistics.hitLabel')}
        value={hitRecordCount}
        suffix={t('dashboard.statistics.hitSuffix')}
        actionLabel={t('dashboard.statistics.hitAction')}
        onClick={onOpenRequestLog}
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
  /** 可点击卡片的动作说明，同时用作无障碍名称；缺省表示卡片只展示数据。 */
  actionLabel?: string;
  /** 点击卡片后的回调；缺省表示卡片不可点击。 */
  onClick?: () => void;
}

/**
 * 单项统计卡片。
 *
 * 传入 onClick 后整张卡片变为按钮：数字本身就是入口，比另起一个按钮更省位置。
 * @param props 图标、名称、数值、单位与可选的点击动作
 */
function StatisticCard({
  icon,
  iconClassName,
  label,
  value,
  suffix,
  actionLabel,
  onClick,
}: StatisticCardProps) {
  /** 卡片主体，可点击与不可点击共用。 */
  const content = (
    <Card
      className={`glow-surface h-full border-border/80 shadow-sm ${
        onClick ? 'glow-surface--clickable' : ''
      }`}
    >
      <CardContent className="flex items-center gap-4 p-5">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold leading-none tracking-tight">
            {value}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{suffix}</span>
          </p>
        </div>
        {actionLabel && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {actionLabel}
            <ChevronRight className="size-3.5" />
          </span>
        )}
      </CardContent>
    </Card>
  );
  if (!onClick) {
    return content;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel}
      className="rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {content}
    </button>
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
