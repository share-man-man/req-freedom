import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, Copy, FolderPlus, GripVertical, LayoutTemplate, Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RULE_HIGHLIGHT_QUERY_PARAM, RuleExecutionChannel } from '@req-freedom/shared';
import type {
  DnrRegistrationIssue,
  DnrRegistrationIssues,
  Rule,
  RuleGroup,
} from '@req-freedom/shared';
import {
  getDnrIssues,
  getEnabled,
  getGroups,
  takePendingRuleHighlight,
  watchDnrIssues,
  watchEnabled,
  watchGroups,
  watchHitTabsChanged,
  watchPendingRuleHighlight,
} from '@/utils/storage';
import {
  commitConfiguration,
  EMPTY_CONFIGURATION_HISTORY_STATUS,
  initializeConfigurationHistory,
  redoConfiguration,
  undoConfiguration,
  watchConfigurationHistory,
  type ConfigurationHistoryStatus,
} from '@/utils/configuration-history';
import { fetchHitTabSummaries, sumHitRecords } from '@/utils/rule-hit-client';
import {
  createConfigurationExport,
  getConfigurationExportFileName,
  parseConfigurationExport,
} from '@/utils/config-transfer';
import { createRuleGroup, createSampleRule, duplicateRule, instantiateRuleTemplate } from '@/utils/factories';
import { formatRuleMethods, getLabels } from '@/utils/labels';
import type { RuleTemplate } from '@/utils/templates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import RequestLogPanel from './RequestLogPanel';
import RuleEditor from './RuleEditor';
import { ACTION_BADGE_CLASS, CHANNEL_BADGE_CLASS } from './rule-badges';
import {
  CurlImportDialog,
  ConfigImportDialog,
  HAR_IMPORT_NEW_GROUP,
  HarImportDialog,
  type HarImportCommit,
} from './RuleImportDialog';
import TemplateLibrary from './TemplateLibrary';
import {
  OPTIONS_VIEW,
  RULE_STATUS_FILTER,
  ManagementStatistics,
  OptionsPageHeader,
  RuleManagementToolbar,
} from './ManagementDashboard';
import type { OptionsView, RuleStatusFilter } from './ManagementDashboard';

/**
 * 规则「表头」与「数据行」共用的网格列模板，保证列对齐。
 *
 * 用 div + CSS Grid 而非原生 <table>：浏览器对 display:table-row 元素的 transform 过渡渲染不可靠，
 * 会导致 dnd-kit 排序时「瞬间换位、无让位动画」；block/grid 布局才能让排序动画稳定生效。
 * 列依次为：拖拽柄 · 启用 · 名称 · 执行通道 · 动作 · 匹配方式 · 请求方法 · 匹配内容 · 操作。
 *
 * 「执行通道」「操作」使用固定宽度，名称 / 动作 / 匹配内容按比例分配余宽；不能使用 auto，
 * 否则每一行会按自身内容分别计算列宽，导致表头和规则内容无法左对齐。
 */
const RULE_ROW_GRID =
  'grid grid-cols-[28px_44px_minmax(0,1.1fr)_100px_minmax(0,1.2fr)_88px_minmax(0,0.8fr)_minmax(0,1.1fr)_104px] items-center gap-3';

/**
 * 无分组时新建规则用的「默认分组」占位 ID。
 *
 * 只在类型选择器 / 规则编辑器里临时代表一个尚未创建的默认分组；只有在规则真正保存时才落地建组，
 * 中途取消则不产生空的默认分组。
 */
const DEFAULT_GROUP_SENTINEL = '__req-freedom:default-group__';

/**
 * 在嵌套的分组结构中定位某条规则所属的分组。
 *
 * 规则只按 ID 引用、不带回指分组的字段，增删改都要先反查归属，故收敛成一个入口。
 * @param groups 全部分组
 * @param ruleId 规则 ID
 * @returns 含该规则的分组；找不到时为 undefined
 */
function findRuleOwnerGroup(groups: RuleGroup[], ruleId: string): RuleGroup | undefined {
  return groups.find((group) => group.rules.some((rule) => rule.id === ruleId));
}

/**
 * 被浏览器拒绝注册的动作徽标样式：与 ACTION_BADGE_CLASS 同一层级，用于覆盖动作本身的配色。
 *
 * 刻意脱离动作色系改用警示色——此时「这个动作是什么」已不重要，重要的是它当前根本不生效。
 */
const REJECTED_ACTION_BADGE_CLASS = 'gap-1 bg-destructive/10 text-destructive';

/**
 * 作用域徽标：规则限定了生效范围（非全部标签页）时展示，提示这条规则只在部分标签生效。
 * @param scope 规则作用域（缺省表示全部标签页，不展示徽标）
 */
function ScopeBadge({ scope }: { scope: Rule['scope'] }) {
  const { t } = useTranslation();
  if (!scope) {
    return null;
  }
  /** 各枚举展示名映射。 */
  const labels = getLabels(t);
  return (
    <Badge
      variant="secondary"
      className="shrink-0 border-transparent bg-amber-500/15 text-[var(--accent-amber)]"
      title={t('app.scopeBadge.title', { scopeLabel: labels.RULE_SCOPE_TYPE_LABELS[scope.type], count: scope.targets.length })}
    >
      {labels.RULE_SCOPE_TYPE_LABELS[scope.type]}
    </Badge>
  );
}

/**
 * 拖拽仅沿垂直方向移动的修饰器（等价官方 restrictToVerticalAxis）
 *
 * 分组与规则都是纵向列表，锁死水平位移可减少无谓的横向抖动，让拖拽更跟手。
 * @param param0 dnd-kit 传入的当前位移
 * @returns 清零水平分量后的位移
 */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * dnd-kit 测量配置：拖拽过程中始终重新测量 droppable 位置。
 *
 * 默认策略只在拖拽开始时测一次，元素让位后位置就过期，会导致「向下拖瞬间换位、向上拖才有动画」
 * 这类方向不对称的跳变。改为 Always 每帧重量，让位动画在两个方向都平滑一致。
 */
const DND_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

/**
 * 统一的拖拽传感器（指针 + 键盘）。
 *
 * 分组列表与各分组的规则列表分别用**独立**的 DndContext，各自调用本 hook 得到一套传感器，
 * 从而让两层拖拽的碰撞检测彻底隔离、互不干扰。
 * @returns dnd-kit 传感器集合
 */
function useSortableSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/**
 * 将 ISO 时间格式化为用于分组摘要的相对时间。
 * @param t 当前语言下的翻译函数
 * @param updatedAt 分组最近更新时间
 * @returns 便于快速扫读的相对时间文案
 */
function formatRelativeTime(t: TFunction, updatedAt: string): string {
  /** 解析后的时间戳。 */
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return t('app.relativeTime.none');
  }
  /** 当前时间与目标时间的分钟差，未来时间按刚刚处理。 */
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) {
    return t('app.relativeTime.justNow');
  }
  if (elapsedMinutes < 60) {
    return t('app.relativeTime.minutesAgo', { count: elapsedMinutes });
  }
  /** 当前时间与目标时间的小时差。 */
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return t('app.relativeTime.hoursAgo', { count: elapsedHours });
  }
  /** 当前时间与目标时间的天数差。 */
  const elapsedDays = Math.floor(elapsedHours / 24);
  return t('app.relativeTime.daysAgo', { count: elapsedDays });
}

/** 规则编辑对话框的状态：正在编辑/新建的规则草稿及其所属分组 */
interface RuleDialogState {
  /** 规则所属分组 ID */
  groupId: string;
  /** 规则草稿 */
  rule: Rule;
  /** 是否为新建 */
  isNew: boolean;
}

interface GroupNameInputProps {
  /** 当前分组名称 */
  value: string;
  /** 提交新名称的回调（失焦或回车时触发） */
  onCommit: (name: string) => void;
}

/**
 * 分组名称的就地编辑输入框：本地维护草稿，失焦或回车时才提交，避免逐字写 storage 触发重复同步
 * @param value 当前分组名称
 * @param onCommit 提交回调
 */
function GroupNameInput({ value, onCommit }: GroupNameInputProps) {
  const { t } = useTranslation();
  /** 输入框内的草稿文本 */
  const [text, setText] = useState(value);

  // 外部名称变化时（如撤销）同步回草稿
  useEffect(() => setText(value), [value]);

  /**
   * 提交草稿：非空且有变化才回调，否则回退到原名称
   */
  const commit = (): void => {
    /** 去除首尾空白后的名称 */
    const trimmed = text.trim();
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setText(value);
    }
  };

  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className="h-8 flex-1 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-border focus-visible:border-ring"
      placeholder={t('app.groupNamePlaceholder')}
    />
  );
}

/** 拖拽句柄的公共外观（可拖拽句柄与拖拽预览里的占位句柄共用） */
const DRAG_HANDLE_CLASS =
  'flex items-center justify-center rounded p-1 text-muted-foreground opacity-50';

interface DragHandleProps {
  /** 悬浮提示文案 */
  title: string;
  /** dnd-kit 的句柄属性与监听器，展开到按钮上 */
  handleProps: Record<string, unknown>;
}

/**
 * 拖拽句柄按钮：规则行与分组卡片共用同一外观与交互态。
 * @param title 悬浮提示文案
 * @param handleProps dnd-kit `useSortable` 返回的 attributes + listeners
 */
function DragHandle({ title, handleProps }: DragHandleProps) {
  return (
    <button
      type="button"
      className={`${DRAG_HANDLE_CLASS} cursor-grab touch-none transition-opacity hover:opacity-100 active:cursor-grabbing`}
      title={title}
      {...handleProps}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

/**
 * 规则行操作列的按钮定义（可交互行与拖拽预览共用）。
 *
 * 两处必须渲染同样多的按钮，否则 Grid 末列宽度对不上、拖拽预览会与真实行错位，
 * 因此增删操作只改这一份定义。
 */
const RULE_ROW_ACTIONS = [
  { key: 'duplicate', Icon: Copy, titleKey: 'app.duplicate', className: '' },
  { key: 'edit', Icon: Pencil, titleKey: 'app.edit', className: '' },
  {
    key: 'delete',
    Icon: Trash2,
    titleKey: 'app.delete',
    className: 'text-muted-foreground hover:text-destructive',
  },
] as const;

/** 规则行操作的标识，用于把按钮定义与各自的点击回调对应起来 */
type RuleRowActionKey = (typeof RULE_ROW_ACTIONS)[number]['key'];

interface RuleRowCellsProps {
  /** 行对应的规则 */
  rule: Rule;
  /** 该规则的 DNR 注册失败记录；未失败或纯展示场景为 undefined */
  issue?: DnrRegistrationIssue;
}

/**
 * 规则行的信息单元格（名称 → 匹配串共 6 列），可交互行与拖拽预览共用同一份渲染，
 * 保证两者列内容与宽度天然一致。开关与操作列因交互差异由各自的行组件渲染。
 */
function RuleRowCells({ rule, issue }: RuleRowCellsProps) {
  const { t } = useTranslation();
  /** 各枚举展示名映射。 */
  const labels = getLabels(t);
  return (
    <>
      {/* 长名字截断，避免撑宽行挤压其他列 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium" title={rule.name}>
          {rule.name}
        </span>
        <ScopeBadge scope={rule.scope} />
      </div>
      <Badge variant="secondary" className={`justify-self-start whitespace-nowrap border-transparent ${CHANNEL_BADGE_CLASS[rule.channel]}`}>
        {rule.channel === RuleExecutionChannel.Dnr ? 'DNR' : t('templateLibrary.channelPagePatch')}
      </Badge>
      <div className="flex min-w-0 flex-wrap items-center gap-1 justify-self-start">
        {rule.actions.map((action) => {
          /** 该动作是否被浏览器拒绝、当前不会生效。 */
          const rejected = issue?.actions.includes(action.type) ?? false;
          return (
            <Badge
              key={action.type}
              variant="secondary"
              className={`whitespace-nowrap border-transparent ${
                rejected ? REJECTED_ACTION_BADGE_CLASS : ACTION_BADGE_CLASS[action.type]
              }`}
              // 浏览器的原始报错通常能直接指出哪里不合法，原样带在提示里
              title={rejected ? t('app.dnrRejected', { message: issue?.message ?? '' }) : undefined}
            >
              {rejected && <AlertTriangle className="size-3" />}
              {labels.RULE_ACTION_TYPE_LABELS[action.type]}
            </Badge>
          );
        })}
      </div>
      <Badge variant="muted" className="justify-self-start whitespace-nowrap">
        {labels.MATCH_TYPE_LABELS[rule.matchType]}
      </Badge>
      <Badge
        variant="outline"
        className="min-w-0 max-w-full justify-self-start truncate whitespace-nowrap font-mono"
        title={formatRuleMethods(t, rule.methods)}
      >
        {formatRuleMethods(t, rule.methods)}
      </Badge>
      <code
        className="min-w-0 max-w-full justify-self-start truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
        title={rule.pattern}
      >
        {rule.pattern}
      </code>
    </>
  );
}

interface SortableRuleRowProps {
  /** 行对应的规则 */
  rule: Rule;
  /** 该规则的 DNR 注册失败记录；未失败时为 undefined */
  issue?: DnrRegistrationIssue;
  /** 切换启用状态回调 */
  onToggle: (id: string) => void;
  /** 进入编辑回调 */
  onEdit: (rule: Rule) => void;
  /** 复制回调 */
  onDuplicate: (id: string) => void;
  /** 删除回调 */
  onDelete: (id: string) => void;
  /** 是否为 popup 跳转后需要强调的目标规则。 */
  highlighted: boolean;
}

/**
 * 可拖拽排序的规则行（div + Grid 实现，保证 dnd-kit 排序动画顺滑）
 */
function SortableRuleRow({
  rule,
  issue,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  highlighted,
}: SortableRuleRowProps) {
  const { t } = useTranslation();
  /** dnd-kit 排序钩子：提供拖拽句柄监听、位移与拖拽态 */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });
  /** 操作列各按钮的点击回调，与 RULE_ROW_ACTIONS 的 key 一一对应 */
  const actionHandlers: Record<RuleRowActionKey, () => void> = {
    duplicate: () => onDuplicate(rule.id),
    edit: () => onEdit(rule),
    delete: () => onDelete(rule.id),
  };

  return (
    <div
      ref={setNodeRef}
      id={`rule-${encodeURIComponent(rule.id)}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 拖拽中原行完全透明留出空位，跟随光标的是 DragOverlay 里的副本
      className={`${RULE_ROW_GRID} group border-t border-border/80 px-4 py-2.5 transition-colors hover:bg-primary/[0.03] ${
        highlighted ? 'rule-target-highlight' : ''
      } ${isDragging ? 'opacity-0' : ''}`}
    >
      <DragHandle title={t('app.dragToReorder')} handleProps={{ ...attributes, ...listeners }} />
      <Switch checked={rule.enabled} onCheckedChange={() => onToggle(rule.id)} />
      <RuleRowCells rule={rule} issue={issue} />
      <div className="flex justify-end gap-1">
        {RULE_ROW_ACTIONS.map(({ key, Icon, titleKey, className }) => (
          <Button
            key={key}
            variant="ghost"
            size="icon"
            className={`size-8 ${className}`}
            title={t(titleKey)}
            onClick={actionHandlers[key]}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>
    </div>
  );
}

interface SortableGroupCardProps {
  /** 分组数据 */
  group: RuleGroup;
  /** 切换整组启用状态 */
  onToggleGroup: (id: string) => void;
  /** 重命名分组 */
  onRenameGroup: (id: string, name: string) => void;
  /** 删除分组 */
  onDeleteGroup: (id: string) => void;
  /** 向分组内新增空白规则 */
  onAddRule: (groupId: string) => void;
  /** 为该分组打开模板库（选用模板后规则落到本组） */
  onOpenTemplates: (groupId: string) => void;
  /** 为该分组打开 cURL 导入（解析出的规则落到本组） */
  onImportCurl: (groupId: string) => void;
  /** 切换组内单条规则启用状态 */
  onToggleRule: (ruleId: string) => void;
  /** 编辑组内规则 */
  onEditRule: (rule: Rule) => void;
  /** 复制组内规则 */
  onDuplicateRule: (ruleId: string) => void;
  /** 删除组内规则 */
  onDeleteRule: (ruleId: string) => void;
  /** 组内规则重排后的回调（传入重排后的规则列表） */
  onReorderRules: (groupId: string, nextRules: Rule[]) => void;
  /** 是否折叠（折叠后隐藏组内规则列表） */
  collapsed: boolean;
  /** 切换折叠状态 */
  onToggleCollapse: (groupId: string) => void;
  /** popup 跳转后需要强调的目标规则 ID。 */
  highlightedRuleId: string | null;
  /** 各规则的 DNR 注册失败记录 */
  dnrIssues: DnrRegistrationIssues;
}

/**
 * 分组卡片：整组可拖拽排序（由外层 DndContext 承载）+ 组开关 + 就地重命名 + 增删规则。
 *
 * 组内规则用**卡片内部独立的 DndContext**排序：规则行只注册到这个内层 context，
 * 外层分组 DndContext 完全看不到它们，两层拖拽的碰撞检测因此彻底隔离、互不干扰。
 */
function SortableGroupCard({
  group,
  onToggleGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddRule,
  onOpenTemplates,
  onImportCurl,
  onToggleRule,
  onEditRule,
  onDuplicateRule,
  onDeleteRule,
  onReorderRules,
  collapsed,
  onToggleCollapse,
  highlightedRuleId,
  dnrIssues,
}: SortableGroupCardProps) {
  const { t } = useTranslation();
  /** dnd-kit 排序钩子：作用于整张分组卡片（仅由标题栏的拖拽句柄触发） */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  /** 组内规则拖拽用的独立传感器 */
  const ruleSensors = useSortableSensors();
  /** 组内正在拖拽的规则 ID，用于内层 DragOverlay 预览 */
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  /** 组内正在拖拽的规则对象 */
  const activeRule = activeRuleId
    ? group.rules.find((rule) => rule.id === activeRuleId)
    : undefined;

  /**
   * 组内规则拖拽结束：在本组内重排
   * @param event dnd-kit 拖拽结束事件
   */
  const handleRuleDragEnd = (event: DragEndEvent): void => {
    setActiveRuleId(null);
    /** 拖起项与落点项 */
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    /** 拖起规则原下标 */
    const oldIndex = group.rules.findIndex((rule) => rule.id === active.id);
    /** 落点规则下标 */
    const newIndex = group.rules.findIndex((rule) => rule.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    onReorderRules(group.id, arrayMove(group.rules, oldIndex, newIndex));
  };

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 拖拽中原卡片完全透明留出空位，跟随光标的是外层 DragOverlay 里的副本
      className={`glow-surface overflow-hidden border-border/80 shadow-sm ${isDragging ? 'opacity-0' : ''}`}
    >
      {/* 分组标题栏：拖拽句柄 · 折叠 · 组开关 · 名称 · 计数 · 增删 */}
      <CardHeader
        className={`flex-row items-center gap-2 px-4 py-3.5 ${collapsed ? '' : 'border-b border-border/80'}`}
      >
        <DragHandle
          title={t('app.dragToReorderGroup')}
          handleProps={{ ...attributes, ...listeners }}
        />
        <button
          type="button"
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={collapsed ? t('app.expand') : t('app.collapse')}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(group.id)}
        >
          <ChevronDown
            className={`size-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
        <Switch
          checked={group.enabled}
          onCheckedChange={() => onToggleGroup(group.id)}
          title={group.enabled ? t('app.disableGroup') : t('app.enableGroup')}
        />
        <GroupNameInput value={group.name} onCommit={(name) => onRenameGroup(group.id, name)} />
        <Badge variant="secondary" className="shrink-0 border-transparent bg-primary/10 text-primary">
          {t('app.groupRuleCount', { count: group.rules.length })}
        </Badge>
        <Badge
          variant="secondary"
          className={`shrink-0 border-transparent ${
            group.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          }`}
        >
          {group.enabled ? t('app.groupEnabled') : t('app.groupDisabled')}
        </Badge>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {t('app.lastUpdated', { time: formatRelativeTime(t, group.updatedAt) })}
        </span>
        <AddRuleMenu
          label={t('app.addRule')}
          onBlank={() => onAddRule(group.id)}
          onTemplate={() => onOpenTemplates(group.id)}
          onCurl={() => onImportCurl(group.id)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          title={t('app.deleteGroup')}
          onClick={() => onDeleteGroup(group.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </CardHeader>

      {/* 组内规则列表；折叠时隐藏，整组停用时淡化，提示规则当前不生效 */}
      {!collapsed && (
      <CardContent className={`p-0 ${group.enabled ? '' : 'opacity-60'}`}>
        {group.rules.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('app.emptyGroupHint')}
          </p>
        ) : (
          <>
            <RuleColumnsHeader />
            {/* 独立于分组的内层 DndContext：只处理本组规则行排序 */}
            <DndContext
              sensors={ruleSensors}
              collisionDetection={closestCenter}
              measuring={DND_MEASURING}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={(event) => setActiveRuleId(String(event.active.id))}
              onDragEnd={handleRuleDragEnd}
              onDragCancel={() => setActiveRuleId(null)}
            >
              <SortableContext
                items={group.rules.map((rule) => rule.id)}
                strategy={verticalListSortingStrategy}
              >
                {group.rules.map((rule) => (
                  <SortableRuleRow
                    key={rule.id}
                    rule={rule}
                    issue={dnrIssues[rule.id]}
                    onToggle={onToggleRule}
                    onEdit={onEditRule}
                    onDuplicate={onDuplicateRule}
                    onDelete={onDeleteRule}
                    highlighted={rule.id === highlightedRuleId}
                  />
                ))}
              </SortableContext>
              <DragOverlay>{activeRule ? <RuleRowOverlay rule={activeRule} /> : null}</DragOverlay>
            </DndContext>
          </>
        )}
      </CardContent>
      )}
    </Card>
  );
}

/**
 * 规则列表表头（与数据行共用同一 Grid 模板保证对齐）。真实分组卡片与拖拽预览均复用。
 */
function RuleColumnsHeader() {
  const { t } = useTranslation();
  return (
    <div className={`${RULE_ROW_GRID} bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground`}>
      <span />
      <span className="whitespace-nowrap">{t('app.columns.enabled')}</span>
      <span className="whitespace-nowrap">{t('app.columns.name')}</span>
      <span className="whitespace-nowrap">{t('app.columns.channel')}</span>
      <span className="whitespace-nowrap">{t('app.columns.actions')}</span>
      <span className="whitespace-nowrap">{t('ruleEditor.matchType')}</span>
      <span className="whitespace-nowrap">{t('ruleEditor.methods')}</span>
      <span className="whitespace-nowrap">{t('app.columns.pattern')}</span>
      <span className="whitespace-nowrap text-right">{t('app.columns.operations')}</span>
    </div>
  );
}

/**
 * 一条规则的纯展示行（无拖拽、无交互），供拖拽预览 1:1 还原真实行外观。
 * 控件为纯展示（onCheckedChange 空实现避免受控警告）。
 * @param rule 规则数据
 */
function RuleRowStatic({ rule }: { rule: Rule }) {
  return (
    <div className={`${RULE_ROW_GRID} px-4 py-2.5`}>
      <span className={DRAG_HANDLE_CLASS}>
        <GripVertical className="size-4" />
      </span>
      <Switch checked={rule.enabled} onCheckedChange={() => {}} />
      <RuleRowCells rule={rule} />
      {/* 操作按钮在预览里只需占位对齐，故渲染为不可点的同尺寸图标 */}
      <div className="flex justify-end gap-1 text-muted-foreground">
        {RULE_ROW_ACTIONS.map(({ key, Icon }) => (
          <span key={key} className="flex size-8 items-center justify-center">
            <Icon className="size-4" />
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 拖拽规则时跟随光标的预览：与真实行 1:1 还原（单行浮起样式）。
 *
 * DragOverlay 内容仅在拖拽开始时渲染一次、之后整体平移，不存在每帧重渲染，故可做全保真。
 * @param rule 正在拖拽的规则
 */
function RuleRowOverlay({ rule }: { rule: Rule }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-lg">
      <RuleRowStatic rule={rule} />
    </div>
  );
}

/**
 * 拖拽分组时跟随光标的预览：等宽高的轻量占位卡片，只展示分组名。
 *
 * DragOverlay 会把源卡片的宽高套到本元素（h-full / w-full 填满），因此无需渲染组内规则或分隔线，
 * 只放分组名做辨识，既轻量又不会出现悬空的横线。
 * @param group 正在拖拽的分组
 */
function GroupCardOverlay({ group }: { group: RuleGroup }) {
  return (
    <div className="flex h-full w-full items-center rounded-xl border border-border bg-card px-4 shadow-lg">
      <span className="truncate text-sm font-medium">{group.name}</span>
    </div>
  );
}

interface AddRuleMenuProps {
  /** 主按钮文案（如「新建规则」「添加规则」）。 */
  label: string;
  /** 选择「空白规则」的回调。 */
  onBlank: () => void;
  /** 选择「从模板库」的回调。 */
  onTemplate: () => void;
  /** 选择「从 cURL 创建」的回调。 */
  onCurl: () => void;
}

/**
 * 新建规则入口：主按钮展开下拉——空白规则 / 从模板库 / 从 cURL。
 *
 * 用与 MatchTester 一致的「点击外部 + Esc 收起」轻量气泡，不引入额外下拉依赖；
 * 菜单经 Portal 挂到 body 并以 fixed 定位，绕开分组卡片的 overflow-hidden 裁剪（折叠 / 空分组时尤为关键）。
 * @param props 文案与两种创建方式的回调
 */
function AddRuleMenu({ label, onBlank, onTemplate, onCurl }: AddRuleMenuProps) {
  const { t } = useTranslation();
  /** 下拉是否展开。 */
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
    // 捕获阶段监听滚动，让菜单跟随任意可滚动祖先
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
      <Button size="sm" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        <Plus />
        {label}
        <ChevronDown className="size-3.5 opacity-80" />
      </Button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: position.top, right: position.right }}
          className="fixed z-50 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onBlank)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <Plus className="size-4 text-muted-foreground" />
            {t('app.addRuleMenu.blank')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onTemplate)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <LayoutTemplate className="size-4 text-muted-foreground" />
            {t('app.addRuleMenu.fromTemplate')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onCurl)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <Terminal className="size-4 text-muted-foreground" />
            {t('ruleImport.menu.curl')}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Options 主界面：规则分组的增删改、启停与组内规则拖拽排序
 */
export default function App() {
  const { t } = useTranslation();
  /** 规则分组列表 */
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  /** 全局开关状态，与 popup 顶部开关共用同一份 storage */
  const [globalEnabled, setGlobalEnabled] = useState(true);
  /** 当前配置时间线的撤销 / 重做能力。 */
  const [historyStatus, setHistoryStatus] = useState<ConfigurationHistoryStatus>(
    EMPTY_CONFIGURATION_HISTORY_STATUS,
  );
  /** 正在恢复历史快照时锁定按钮，避免连续点击造成游标竞争。 */
  const [historyBusy, setHistoryBusy] = useState(false);
  /** 规则编辑对话框状态，null 表示关闭 */
  const [ruleDialog, setRuleDialog] = useState<RuleDialogState | null>(null);
  /** 模板库对话框的目标分组 ID：非 null 即打开，选用模板后规则落到该分组（可为默认分组占位）。 */
  const [templateTargetGroupId, setTemplateTargetGroupId] = useState<string | null>(null);
  /** 当前导入弹窗展示的导入方式；null 表示关闭。 */
  const [ruleImportDialog, setRuleImportDialog] = useState<'config' | 'curl' | 'har' | null>(null);
  /** cURL 导入的目标分组；从头部「导入规则」进入时为 null，表示沿用首个分组。 */
  const [curlTargetGroupId, setCurlTargetGroupId] = useState<string | null>(null);
  /** 当前正在拖拽的分组 ID，用于渲染外层分组 DragOverlay 预览 */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  /** 已折叠的分组 ID 集合（纯视图状态，不写入 storage，避免无谓触发规则重同步） */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  /** 导入 / 导出结果的就地提示。 */
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  /** 搜索分组名、规则名与匹配内容的关键词。 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 分组启用状态筛选。 */
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>(RULE_STATUS_FILTER.All);
  /** 规则执行通道筛选。 */
  const [channelFilter, setChannelFilter] = useState<RuleExecutionChannel | 'all'>('all');
  /** popup 跳转后需要滚动定位并临时高亮的规则 ID。 */
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get(RULE_HIGHLIGHT_QUERY_PARAM),
  );
  /** 当前展示的主视图；请求日志从顶栏「更多」菜单进入。 */
  const [view, setView] = useState<OptionsView>(OPTIONS_VIEW.Rules);

  /** 各规则的 DNR 注册失败记录，用于在规则行上标出不会生效的动作。 */
  const [dnrIssues, setDnrIssues] = useState<DnrRegistrationIssues>({});
  /** 各标签页合计的命中记录条数，统计卡片据此展示并作为请求日志入口。 */
  const [hitRecordCount, setHitRecordCount] = useState(0);

  // 复用同一个 options 标签页时，通过 session 中的一次性请求接收 popup 发来的规则定位。
  useEffect(() => {
    /** 将外部定位请求切回规则视图并交给既有的展开、滚动和高亮流程。 */
    const highlightRule = (ruleId: string): void => {
      setView(OPTIONS_VIEW.Rules);
      setHighlightedRuleId(ruleId);
    };
    /** 先订阅再读取，避免页面挂载期间遗漏刚写入的定位请求。 */
    const unwatch = watchPendingRuleHighlight(highlightRule);
    void takePendingRuleHighlight().then((ruleId) => {
      if (ruleId) {
        highlightRule(ruleId);
      }
    });
    return unwatch;
  }, []);

  // 初始化 session 历史，并跟随 popup 等其他扩展页面提交的时间线变化。
  useEffect(() => {
    /** 历史变化订阅。 */
    const unwatch = watchConfigurationHistory(setHistoryStatus);
    void initializeConfigurationHistory().then(setHistoryStatus);
    return unwatch;
  }, []);

  // 初始加载分组，并订阅后续变化：popup 里切换全局/分组/规则开关后，长驻的管理页随之刷新
  useEffect(() => {
    /** 应用外部写入的分组；与当前内容一致时保持原引用，避免本页自身写入的回声引发无谓重渲染。 */
    const applyExternalGroups = (nextGroups: RuleGroup[]): void => {
      setGroups((previousGroups) =>
        JSON.stringify(previousGroups) === JSON.stringify(nextGroups) ? previousGroups : nextGroups,
      );
    };
    /** 订阅是否已送来更新的分组，用于丢弃随后才返回的首次读取结果。 */
    let hasReceivedUpdate = false;
    /** 先订阅再读取，避免首次读取与订阅之间的写入被漏掉。 */
    const unwatch = watchGroups((nextGroups) => {
      hasReceivedUpdate = true;
      applyExternalGroups(nextGroups);
    });
    void getGroups().then((initialGroups) => {
      if (!hasReceivedUpdate) {
        applyExternalGroups(initialGroups);
      }
    });
    return unwatch;
  }, []);

  // 全局开关同样订阅：popup 切换或导入配置整体覆盖后，顶栏开关立即反映最新状态
  useEffect(() => {
    /** 订阅是否已送来新的开关值，用于丢弃随后才返回的首次读取结果。 */
    let hasReceivedUpdate = false;
    const unwatch = watchEnabled((nextEnabled) => {
      hasReceivedUpdate = true;
      setGlobalEnabled(nextEnabled);
    });
    void getEnabled().then((initialEnabled) => {
      if (!hasReceivedUpdate) {
        setGlobalEnabled(initialEnabled);
      }
    });
    return unwatch;
  }, []);

  // 注册失败记录由 background 每轮同步后写入 storage.session，这里读取一次并订阅后续变化
  useEffect(() => {
    void getDnrIssues().then(setDnrIssues);
    return watchDnrIssues(setDnrIssues);
  }, []);

  // 命中条数读一次后订阅命中镜像：统计卡片随页面的新请求增长，无需手动刷新管理页
  useEffect(() => {
    /** 重新汇总各标签页的命中条数；读取失败时保留上一次的数字，卡片不为此报错。 */
    const refresh = (): void => {
      void fetchHitTabSummaries()
        .then((summaries) => setHitRecordCount(sumHitRecords(summaries ?? [])))
        .catch(() => undefined);
    };
    refresh();
    return watchHitTabsChanged(refresh);
  }, []);

  // popup 带规则 ID 跳转时，清除会隐藏目标的筛选、展开所属分组，再滚动并高亮目标行。
  useEffect(() => {
    if (!highlightedRuleId || groups.length === 0) {
      return undefined;
    }
    /** 目标规则所属的分组。 */
    const ownerGroup = groups.find((group) =>
      group.rules.some((rule) => rule.id === highlightedRuleId),
    );
    if (!ownerGroup) {
      setHighlightedRuleId(null);
      return undefined;
    }

    setSearchQuery('');
    setStatusFilter(RULE_STATUS_FILTER.All);
    setChannelFilter('all');
    setCollapsedGroupIds((previousGroupIds) => {
      /** 确保目标规则所在分组处于展开状态。 */
      const nextGroupIds = new Set(previousGroupIds);
      nextGroupIds.delete(ownerGroup.id);
      return nextGroupIds;
    });

    /** 清理地址栏参数，避免刷新页面后重复执行定位动画。 */
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(RULE_HIGHLIGHT_QUERY_PARAM);
    window.history.replaceState(null, '', cleanUrl);

    /** 等待筛选与折叠状态完成渲染后再滚动。 */
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`rule-${encodeURIComponent(highlightedRuleId)}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    /** 高亮保留一段时间，足够用户完成视觉定位。 */
    const timer = window.setTimeout(() => setHighlightedRuleId(null), 5000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [groups, highlightedRuleId]);

  /** 分组列表拖拽用的传感器（与各分组内规则列表的传感器相互独立） */
  const groupSensors = useSortableSensors();

  /**
   * 更新分组列表并持久化
   * @param next 新的分组列表
   * @param label 本次用户操作名称
   * @param updatedGroupIds 需要刷新最近更新时间的分组 ID
   */
  const persist = async (
    next: RuleGroup[],
    label: string,
    updatedGroupIds: readonly string[] = [],
  ): Promise<void> => {
    /** 本次操作发生时刻，用于统一更新受影响分组的摘要时间。 */
    const updatedAt = new Date().toISOString();
    /** 需要写入最新更新时间的分组 ID。 */
    const updatedGroupIdSet = new Set(updatedGroupIds);
    /** 已附带最新更新时间的持久化数据。 */
    const groupsWithUpdatedAt = next.map((group) =>
      updatedGroupIdSet.has(group.id) ? { ...group, updatedAt } : group,
    );
    setGroups(groupsWithUpdatedAt);
    await commitConfiguration(
      { enabled: globalEnabled, groups: groupsWithUpdatedAt },
      label,
    );
  };

  /**
   * 切换全局开关并持久化：关闭后所有规则都不生效，与 popup 顶部开关是同一份状态。
   * @param next 切换后的开关值
   */
  const handleToggleGlobalEnabled = (next: boolean): void => {
    setGlobalEnabled(next);
    /** 便于撤销菜单说明本次全局开关变化的名称。 */
    const label = next
      ? t('dashboard.header.globalEnabled')
      : t('dashboard.header.globalDisabled');
    void commitConfiguration({ enabled: next, groups }, label);
  };

  /**
   * 从请求日志跳回规则视图并定位该规则。
   *
   * 复用既有的高亮流程：设置目标规则 ID 后，负责清筛选、展开分组与滚动的副作用会自行接管。
   * @param ruleId 要定位的业务规则 ID
   */
  const handleJumpToRule = (ruleId: string): void => {
    setView(OPTIONS_VIEW.Rules);
    setHighlightedRuleId(ruleId);
  };

  // ---------- 分组操作 ----------

  /**
   * 新建一个空分组并追加到末尾
   */
  const handleAddGroup = (): void => {
    void persist([...groups, createRuleGroup(t)], t('app.newGroup'));
  };

  // ---------- 导入 / 导出 ----------

  /**
   * 将当前全部规则与全局开关下载为带 schema 版本的 JSON 文件。
   */
  const handleExport = async (): Promise<void> => {
    try {
      /** 当前的全局启用状态。 */
      const enabled = await getEnabled();
      /** 要写入下载文件的完整配置快照。 */
      const configuration = createConfigurationExport(groups, enabled);
      /** 可供浏览器下载的 JSON 文件内容。 */
      const blob = new Blob([JSON.stringify(configuration, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      /** 当前下载文件的临时 URL。 */
      const downloadUrl = URL.createObjectURL(blob);
      /** 仅用于触发浏览器下载的临时链接元素。 */
      const downloadLink = document.createElement('a');
      downloadLink.href = downloadUrl;
      downloadLink.download = getConfigurationExportFileName(configuration.exportedAt);
      downloadLink.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setTransferMessage(t('app.transfer.exportSuccess'));
    } catch {
      setTransferMessage(t('app.transfer.exportFailure'));
    }
  };

  /**
   * 打开 cURL 导入弹窗并记录目标分组。
   * @param groupId 解析结果要落入的分组；null 表示沿用首个分组
   */
  const handleOpenCurlImport = (groupId: string | null): void => {
    setCurlTargetGroupId(groupId);
    setRuleImportDialog('curl');
  };

  /**
   * cURL 解析完成后复用原有单条新建规则编辑器。
   * @param rule 解析生成的规则草稿
   */
  const handleContinueCurlImport = (rule: Rule): void => {
    /** 从某分组的「添加规则」进入时落到该组；从头部导入进入时退回首个分组。 */
    const groupId = curlTargetGroupId ?? groups[0]?.id ?? DEFAULT_GROUP_SENTINEL;
    setRuleImportDialog(null);
    setRuleDialog({ groupId, rule, isNew: true });
  };

  /**
   * 把 HAR 批量规则一次追加到新分组或现有分组。
   * @param commit 批量保存参数
   */
  const handleCommitHarImport = async (commit: HarImportCommit): Promise<void> => {
    /** 提交前重新读取的最新分组，避免覆盖 popup 同期修改。 */
    const latestGroups = await getGroups();
    /** 本次提交时间。 */
    const updatedAt = new Date().toISOString();
    /** 为最终落库重新生成 ID 的规则。 */
    const importedRules = commit.rules.map((rule) => ({
      ...structuredClone(rule),
      id: crypto.randomUUID(),
      enabled:
        commit.targetGroupId === HAR_IMPORT_NEW_GROUP
          ? true
          : commit.enableImmediately,
    }));
    /** 追加导入内容后的分组。 */
    let nextGroups: RuleGroup[];
    if (commit.targetGroupId === HAR_IMPORT_NEW_GROUP) {
      /** 新建的 HAR 导入分组。 */
      const importedGroup = {
        ...createRuleGroup(t, commit.newGroupName),
        enabled: commit.enableImmediately,
        rules: importedRules,
      };
      nextGroups = [...latestGroups, importedGroup];
    } else {
      if (!latestGroups.some((group) => group.id === commit.targetGroupId)) {
        throw new Error(t('ruleImport.har.targetGroupMissing'));
      }
      /** 追加到目标现有分组后的列表。 */
      nextGroups = latestGroups.map((group) =>
        group.id === commit.targetGroupId
          ? {
              ...group,
              updatedAt,
              rules: [...group.rules, ...importedRules],
            }
          : group,
      );
    }
    /** 提交时最新的全局开关，避免批量解析期间覆盖 popup 的同步修改。 */
    const latestEnabled = await getEnabled();
    await commitConfiguration(
      { enabled: latestEnabled, groups: nextGroups },
      t('ruleImport.tabs.har'),
    );
    setGroups(nextGroups);
    setRuleImportDialog(null);
    setTransferMessage(
      t('ruleImport.har.success', { count: importedRules.length }),
    );
  };

  /**
   * 校验 JSON 文本并整体替换当前配置。
   * @param content 文件上传或直接粘贴的 JSON 文本
   * @returns 是否完成导入；用户取消覆盖确认时返回 false
   */
  const handleImport = async (content: string): Promise<boolean> => {
    try {
      /** 已通过结构与 schema 校验的配置。 */
      const configuration = parseConfigurationExport(t, content);
      /** 导入配置中包含的规则总数。 */
      const ruleCount = configuration.groups.reduce((count, group) => count + group.rules.length, 0);
      if (
        !window.confirm(
          t('app.transfer.importConfirm', { groupCount: configuration.groups.length, ruleCount }),
        )
      ) {
        return false;
      }
      await commitConfiguration(
        { enabled: configuration.enabled, groups: configuration.groups },
        t('ruleImport.tabs.config'),
      );
      setGroups(configuration.groups);
      setCollapsedGroupIds(new Set());
      setTransferMessage(t('app.transfer.importSuccess', { groupCount: configuration.groups.length, ruleCount }));
      setRuleImportDialog(null);
      return true;
    } catch (error) {
      /** 便于用户定位问题的导入错误。 */
      const message = error instanceof Error ? error.message : t('app.transfer.importParseFailure');
      throw new Error(t('app.transfer.importFailure', { message }));
    }
  };

  /**
   * 切换分组折叠状态（纯视图状态，不持久化）
   * @param id 分组 ID
   */
  const handleToggleCollapse = (id: string): void => {
    setCollapsedGroupIds((prev) => {
      /** 下一份折叠集合 */
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /**
   * 切换整组启用状态
   * @param id 分组 ID
   */
  const handleToggleGroup = (id: string): void => {
    /** 切换前的目标分组。 */
    const targetGroup = groups.find((group) => group.id === id);
    /** 与切换结果对应的用户操作名称。 */
    const label = targetGroup?.enabled ? t('app.disableGroup') : t('app.enableGroup');
    void persist(
      groups.map((group) => (group.id === id ? { ...group, enabled: !group.enabled } : group)),
      label,
      [id],
    );
  };

  /**
   * 重命名分组
   * @param id 分组 ID
   * @param name 新名称
   */
  const handleRenameGroup = (id: string, name: string): void => {
    void persist(
      groups.map((group) => (group.id === id ? { ...group, name } : group)),
      t('app.edit'),
      [id],
    );
  };

  /**
   * 删除分组（含组内规则）；非空分组删除前二次确认
   * @param id 分组 ID
   */
  const handleDeleteGroup = (id: string): void => {
    /** 待删除的分组 */
    const target = groups.find((group) => group.id === id);
    if (target && target.rules.length > 0) {
      // 非空分组会连同规则一起删除，容易误操作，删除前确认
      if (!window.confirm(t('app.deleteGroupConfirm', { name: target.name, count: target.rules.length }))) {
        return;
      }
    }
    void persist(groups.filter((group) => group.id !== id), t('app.deleteGroup'));
  };

  // ---------- 规则操作 ----------

  /**
   * 直接打开统一规则编辑器，准备向指定分组新增规则
   * @param groupId 目标分组 ID
   */
  const handleAddRule = (groupId: string): void => {
    setRuleDialog({ groupId, rule: createSampleRule(t), isNew: true });
  };

  /**
   * 无分组时直接新建规则：以「默认分组」占位打开编辑器，保存时才真正建组
   */
  const handleAddFirstRule = (): void => {
    setRuleDialog({ groupId: DEFAULT_GROUP_SENTINEL, rule: createSampleRule(t), isNew: true });
  };

  /**
   * 为指定分组打开模板库。
   * @param groupId 选用模板后规则应落到的分组 ID（无分组时传默认分组占位）
   */
  const handleOpenTemplates = (groupId: string): void => {
    setTemplateTargetGroupId(groupId);
  };

  /**
   * 选用模板：实例化规则草稿并打开规则编辑器，交由用户微调匹配范围后再保存。
   * 目标分组来自打开模板库时记录的 templateTargetGroupId（默认分组占位则保存时才真正建组）。
   * @param template 选中的常用规则模板
   */
  const handleUseTemplate = (template: RuleTemplate): void => {
    /** 规则应归属的分组：来自打开入口，缺省回退到默认分组占位。 */
    const targetGroupId = templateTargetGroupId ?? DEFAULT_GROUP_SENTINEL;
    setTemplateTargetGroupId(null);
    setRuleDialog({ groupId: targetGroupId, rule: instantiateRuleTemplate(t, template), isNew: true });
  };

  /**
   * 打开规则编辑器编辑已有规则
   * @param rule 目标规则
   */
  const handleEditRule = (rule: Rule): void => {
    /** 规则所属分组 */
    const owner = findRuleOwnerGroup(groups, rule.id);
    if (!owner) {
      return;
    }
    setRuleDialog({ groupId: owner.id, rule, isNew: false });
  };

  /**
   * 保存规则：新建则追加到目标分组，编辑则替换；改选分组时把规则移动到目标分组
   * @param rule 编辑后的规则
   * @param targetGroupId 规则应归属的分组 ID
   */
  const handleSaveRule = (rule: Rule, targetGroupId: string): void => {
    // 目标是「默认分组」占位：此刻才真正创建默认分组并放入该规则（取消则不会走到这里，故不留空组）
    if (targetGroupId === DEFAULT_GROUP_SENTINEL) {
      void persist(
        [...groups, { ...createRuleGroup(t, t('group.autoDefaultName')), rules: [rule] }],
        t('app.newRule'),
      );
      setRuleDialog(null);
      return;
    }
    /** 应用了增删改与跨组移动后的分组列表 */
    const next = groups.map((group) => {
      // 先从当前分组移除同 ID 的旧规则（跨组移动时的“源组删除”）
      /** 移除旧规则后的组内规则 */
      const withoutRule = group.rules.filter((item) => item.id !== rule.id);
      if (group.id !== targetGroupId) {
        return { ...group, rules: withoutRule };
      }
      // 目标分组：原地替换（保持顺序）或追加新规则
      /** 目标分组是否已含该规则 */
      const existed = group.rules.some((item) => item.id === rule.id);
      return {
        ...group,
        rules: existed
          ? group.rules.map((item) => (item.id === rule.id ? rule : item))
          : [...withoutRule, rule],
      };
    });
    /** 原规则所在的分组，跨分组保存时也应刷新其更新时间。 */
    const sourceGroupId = findRuleOwnerGroup(groups, rule.id)?.id;
    /** 本次需要更新时间的分组 ID。 */
    const updatedGroupIds = sourceGroupId
      ? [sourceGroupId, targetGroupId]
      : [targetGroupId];
    /** 保存前的弹窗状态决定这是新建还是编辑操作。 */
    const label = ruleDialog?.isNew ? t('app.newRule') : t('app.edit');
    void persist(next, label, updatedGroupIds);
    setRuleDialog(null);
  };

  /**
   * 复制规则：在原规则所在分组内，紧随原规则之后插入一份同内容的副本
   * @param ruleId 被复制规则的 ID
   */
  const handleDuplicateRule = (ruleId: string): void => {
    /** 被复制规则所属的分组。 */
    const owner = findRuleOwnerGroup(groups, ruleId);
    if (!owner) {
      return;
    }
    /** 原规则在组内的下标，副本插入其后。 */
    const index = owner.rules.findIndex((rule) => rule.id === ruleId);
    /** 换了新 id 与副本名的规则拷贝。 */
    const copy = duplicateRule(t, owner.rules[index]);
    void persist(
      groups.map((group) =>
        group.id === owner.id
          ? {
              ...group,
              rules: [
                ...group.rules.slice(0, index + 1),
                copy,
                ...group.rules.slice(index + 1),
              ],
            }
          : group,
      ),
      t('app.duplicate'),
      [owner.id],
    );
  };

  /**
   * 删除规则
   * @param ruleId 规则 ID
   */
  const handleDeleteRule = (ruleId: string): void => {
    /** 被删除规则原本所属的分组。 */
    const ownerGroupId = findRuleOwnerGroup(groups, ruleId)?.id;
    void persist(
      groups.map((group) => ({
        ...group,
        rules: group.rules.filter((rule) => rule.id !== ruleId),
      })),
      t('app.delete'),
      ownerGroupId ? [ownerGroupId] : [],
    );
  };

  /**
   * 切换单条规则启用状态
   * @param ruleId 规则 ID
   */
  const handleToggleRule = (ruleId: string): void => {
    /** 被切换规则所属的分组。 */
    const ownerGroupId = findRuleOwnerGroup(groups, ruleId)?.id;
    void persist(
      groups.map((group) => ({
        ...group,
        rules: group.rules.map((rule) =>
          rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule,
        ),
      })),
      t('app.edit'),
      ownerGroupId ? [ownerGroupId] : [],
    );
  };

  /**
   * 组内规则重排后写回对应分组
   * @param groupId 分组 ID
   * @param nextRules 重排后的组内规则
   */
  const handleReorderRules = (groupId: string, nextRules: Rule[]): void => {
    void persist(
      groups.map((group) => (group.id === groupId ? { ...group, rules: nextRules } : group)),
      t('app.dragToReorder'),
      [groupId],
    );
  };

  // ---------- 分组拖拽排序（外层 DndContext） ----------

  /**
   * 分组拖拽结束：分组之间重排
   * @param event dnd-kit 拖拽结束事件
   */
  const handleGroupDragEnd = (event: DragEndEvent): void => {
    setActiveGroupId(null);
    /** 拖起项与落点项 */
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    /** 拖起分组原下标 */
    const oldIndex = groups.findIndex((group) => group.id === active.id);
    /** 落点分组下标 */
    const newIndex = groups.findIndex((group) => group.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    void persist(
      arrayMove(groups, oldIndex, newIndex),
      t('app.dragToReorderGroup'),
      [String(active.id), String(over.id)],
    );
  };

  /**
   * 撤销最近一次已保存的配置修改。
   */
  const handleUndo = async (): Promise<void> => {
    setHistoryBusy(true);
    try {
      /** 历史仓库恢复的上一份配置。 */
      const result = await undoConfiguration();
      if (result) {
        setGroups(result.snapshot.groups);
        setGlobalEnabled(result.snapshot.enabled);
        setHistoryStatus(result.status);
      }
    } finally {
      setHistoryBusy(false);
    }
  };

  /**
   * 重做最近一次被撤销的配置修改。
   */
  const handleRedo = async (): Promise<void> => {
    setHistoryBusy(true);
    try {
      /** 历史仓库恢复的下一份配置。 */
      const result = await redoConfiguration();
      if (result) {
        setGroups(result.snapshot.groups);
        setGlobalEnabled(result.snapshot.enabled);
        setHistoryStatus(result.status);
      }
    } finally {
      setHistoryBusy(false);
    }
  };

  // 配置历史只在失焦、保存等提交动作时生成；焦点位于输入控件或 CodeMirror 时，
  // 撤销 / 重做快捷键交给控件自身，避免事件冒泡到 window 后误操作整份配置。
  useEffect(() => {
    /** 配置历史键盘监听器。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      /** 当前事件目标元素。 */
      const target = event.target as HTMLElement | null;
      /** 是否处于应保留原生文本撤销能力的可编辑控件中。 */
      const isEditing =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA';
      if (isEditing || historyBusy || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      /** 是否为常见的重做快捷键。 */
      const wantsRedo =
        (event.key.toLocaleLowerCase() === 'z' && event.shiftKey) ||
        event.key.toLocaleLowerCase() === 'y';
      /** 是否为不带 Shift 的撤销快捷键。 */
      const wantsUndo = event.key.toLocaleLowerCase() === 'z' && !event.shiftKey;
      if (wantsUndo && historyStatus.canUndo) {
        event.preventDefault();
        void handleUndo();
      } else if (wantsRedo && historyStatus.canRedo) {
        event.preventDefault();
        void handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyBusy, historyStatus]);

  /** 所有分组内的规则总数。 */
  const totalRuleCount = groups.reduce((count, group) => count + group.rules.length, 0);
  /** 当前实际生效的规则数量：分组与规则均为启用才计入。 */
  const enabledRuleCount = groups.reduce(
    (count, group) => count + group.rules.filter((rule) => group.enabled && rule.enabled).length,
    0,
  );
  /** 应用于搜索的标准化关键词。 */
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  /** 不修改原始 storage 顺序的分组派生展示数据。 */
  const visibleGroups = useMemo(() => {
    /** 通过状态、搜索与类型筛选的分组及其规则。 */
    const filteredGroups = groups.reduce<RuleGroup[]>((result, group) => {
      /** 当前分组是否匹配启用状态筛选。 */
      const matchesStatus =
        statusFilter === RULE_STATUS_FILTER.All ||
        (statusFilter === RULE_STATUS_FILTER.Enabled && group.enabled) ||
        (statusFilter === RULE_STATUS_FILTER.Disabled && !group.enabled);
      if (!matchesStatus) {
        return result;
      }
      /** 搜索词是否命中分组名称。 */
      const matchesGroupName =
        !normalizedSearchQuery || group.name.toLocaleLowerCase().includes(normalizedSearchQuery);
      /** 当前视图中需要展示的组内规则。 */
      const matchingRules = group.rules.filter((rule) => {
        /** 规则通道是否命中筛选条件。 */
        const matchesChannel = channelFilter === 'all' || rule.channel === channelFilter;
        /** 搜索词是否命中规则名称或匹配内容。 */
        const matchesRuleSearch =
          matchesGroupName ||
          !normalizedSearchQuery ||
          rule.name.toLocaleLowerCase().includes(normalizedSearchQuery) ||
          rule.pattern.toLocaleLowerCase().includes(normalizedSearchQuery);
        return matchesChannel && matchesRuleSearch;
      });
      /** 空分组在无搜索、无类型筛选时保留；有筛选时仅展示含命中规则的分组。 */
      const shouldShowGroup =
        matchingRules.length > 0 ||
        (group.rules.length === 0 && !normalizedSearchQuery && channelFilter === 'all');
      if (shouldShowGroup) {
        result.push({ ...group, rules: matchingRules });
      }
      return result;
    }, []);
    return filteredGroups;
  }, [channelFilter, groups, normalizedSearchQuery, statusFilter]);

  /** 供编辑器「所属分组」下拉使用的分组精简信息 */
  const groupOptions = groups.map((group) => ({ id: group.id, name: group.name }));
  /** 传给编辑器的分组选项：向「默认分组」新建首条规则时注入一个占位选项供下拉展示 */
  const editorGroupOptions =
    ruleDialog?.groupId === DEFAULT_GROUP_SENTINEL
      ? [{ id: DEFAULT_GROUP_SENTINEL, name: t('group.autoDefaultName') }, ...groupOptions]
      : groupOptions;
  /** 正在拖拽的分组，用于外层 DragOverlay 预览 */
  const activeGroup = activeGroupId
    ? groups.find((group) => group.id === activeGroupId)
    : undefined;
  /** ReqFreedom Tab 自动回填的当前本地配置；没有分组时保持空白。 */
  const configImportInitialContent = groups.length > 0
    ? JSON.stringify(createConfigurationExport(groups, globalEnabled), null, 2)
    : '';

  return (
    <div className="min-h-screen">
      <OptionsPageHeader
        enabled={globalEnabled}
        onToggleEnabled={handleToggleGlobalEnabled}
        canUndo={historyStatus.canUndo && !historyBusy}
        canRedo={historyStatus.canRedo && !historyBusy}
        undoLabel={historyStatus.undoLabel}
        redoLabel={historyStatus.redoLabel}
        onUndo={() => void handleUndo()}
        onRedo={() => void handleRedo()}
        onImport={() => {
          setCurlTargetGroupId(null);
          setRuleImportDialog('config');
        }}
        onExport={() => void handleExport()}
      />

      <main className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
        {view === OPTIONS_VIEW.Logs ? (
          <RequestLogPanel
            groups={groups}
            onBack={() => setView(OPTIONS_VIEW.Rules)}
            onJumpToRule={handleJumpToRule}
          />
        ) : (
          <>
        {groups.length > 0 && (
          <>
            <ManagementStatistics
              groupCount={groups.length}
              ruleCount={totalRuleCount}
              enabledRuleCount={enabledRuleCount}
              hitRecordCount={hitRecordCount}
              onOpenRequestLog={() => setView(OPTIONS_VIEW.Logs)}
            />
            <RuleManagementToolbar
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              channelFilter={channelFilter}
              onChannelFilterChange={setChannelFilter}
            />
          </>
        )}
        {transferMessage && (
          <p className="rounded-lg border border-border/80 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm" role="status">
            {transferMessage}
          </p>
        )}

        {/* 分组列表（分组与组内规则均支持拖拽排序） */}
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderPlus className="size-6" />
            </span>
            <div>
              <p className="text-sm font-medium">{t('app.emptyState.title')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('app.emptyState.hint', { defaultGroupName: t('group.autoDefaultName') })}
              </p>
            </div>
            <div className="flex gap-2">
              <AddRuleMenu
                label={t('app.newRule')}
                onBlank={handleAddFirstRule}
                onTemplate={() => handleOpenTemplates(DEFAULT_GROUP_SENTINEL)}
                onCurl={() => handleOpenCurlImport(DEFAULT_GROUP_SENTINEL)}
              />
              <Button variant="outline" size="sm" onClick={handleAddGroup}>
                <FolderPlus />
                {t('app.newGroup')}
              </Button>
            </div>
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <p className="text-sm font-medium">{t('app.noMatchingGroups')}</p>
            <p className="text-xs text-muted-foreground">{t('app.noMatchingGroupsHint')}</p>
          </div>
        ) : (
          // 分组 DndContext 不用 MeasuringStrategy.Always：分组 droppable 是整张大卡片，
          // 每帧重测会触发布局读取导致掉帧。分组与规则已是独立 context 无嵌套干扰，
          // 默认 WhileDragging（仅开始时测一次）即可，且省掉每帧测量开销。
          <DndContext
            sensors={groupSensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={(event) => setActiveGroupId(String(event.active.id))}
            onDragEnd={handleGroupDragEnd}
            onDragCancel={() => setActiveGroupId(null)}
          >
            <SortableContext
              items={visibleGroups.map((group) => group.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-3">
                {visibleGroups.map((group) => (
                  <SortableGroupCard
                    key={group.id}
                    group={group}
                    onToggleGroup={handleToggleGroup}
                    onRenameGroup={handleRenameGroup}
                    onDeleteGroup={handleDeleteGroup}
                    onAddRule={handleAddRule}
                    onOpenTemplates={handleOpenTemplates}
                    onImportCurl={handleOpenCurlImport}
                    onToggleRule={handleToggleRule}
                    onEditRule={handleEditRule}
                    onDuplicateRule={handleDuplicateRule}
                    onDeleteRule={handleDeleteRule}
                    onReorderRules={handleReorderRules}
                    collapsed={collapsedGroupIds.has(group.id)}
                    onToggleCollapse={handleToggleCollapse}
                    highlightedRuleId={highlightedRuleId}
                    dnrIssues={dnrIssues}
                  />
                ))}
              </div>
            </SortableContext>

            {/* 分组拖拽预览：轻量副本跟随光标，真实卡片淡化为占位 */}
            <DragOverlay>{activeGroup ? <GroupCardOverlay group={activeGroup} /> : null}</DragOverlay>
          </DndContext>
        )}

        {groups.length > 0 && (
          <Button variant="outline" className="w-full" onClick={handleAddGroup}>
            <FolderPlus />
            {t('app.newGroup')}
          </Button>
        )}
          </>
        )}
      </main>

      {/* 常用规则模板库 */}
      <TemplateLibrary
        open={templateTargetGroupId !== null}
        onClose={() => setTemplateTargetGroupId(null)}
        onUse={handleUseTemplate}
      />

      {/* 新建 / 编辑规则对话框 */}
      <Dialog open={ruleDialog !== null} onOpenChange={(open) => !open && setRuleDialog(null)}>
        <DialogContent
          className="max-w-3xl"
          // 点击遮罩不关闭，避免长表单编辑到一半误触丢失（仍可用关闭按钮或 Esc 退出）
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {ruleDialog && (
            <RuleEditor
              // key 保证切换编辑对象时重建草稿状态
              key={ruleDialog.rule.id}
              rule={ruleDialog.rule}
              isNew={ruleDialog.isNew}
              groups={editorGroupOptions}
              groupId={ruleDialog.groupId}
              onSave={handleSaveRule}
              onCancel={() => setRuleDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* cURL 单条创建 / HAR 批量创建规则。 */}
      <Dialog
        open={ruleImportDialog !== null}
        onOpenChange={(open) => !open && setRuleImportDialog(null)}
      >
        <DialogContent
          className="h-[min(52rem,calc(100vh-2rem))] max-h-none w-[min(64rem,calc(100vw-2rem))] max-w-none"
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="flex-col items-stretch gap-4 pr-10">
            <DialogTitle>{t('dashboard.header.import')}</DialogTitle>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist">
              {(['config', 'har', 'curl'] as const).map((method) => {
                /** 从分组的添加规则菜单进入时，只允许使用带目标分组的 cURL 导入。 */
                const disabled = curlTargetGroupId !== null && method !== 'curl';
                return (
                  <button
                    key={method}
                    type="button"
                    role="tab"
                    disabled={disabled}
                    aria-selected={ruleImportDialog === method}
                    onClick={() => setRuleImportDialog(method)}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      ruleImportDialog === method
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground`}
                  >
                    {t(`ruleImport.tabs.${method}`)}
                  </button>
                );
              })}
            </div>
          </DialogHeader>
          {ruleImportDialog === 'config' && (
            <ConfigImportDialog
              initialContent={configImportInitialContent}
              onCancel={() => setRuleImportDialog(null)}
              onImport={handleImport}
            />
          )}
          {ruleImportDialog === 'curl' && (
            <CurlImportDialog
              onCancel={() => setRuleImportDialog(null)}
              onContinue={handleContinueCurlImport}
            />
          )}
          {ruleImportDialog === 'har' && (
            <HarImportDialog
              groups={groupOptions}
              onCancel={() => setRuleImportDialog(null)}
              onCommit={handleCommitHarImport}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
