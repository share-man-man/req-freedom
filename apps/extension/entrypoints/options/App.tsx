import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderPlus, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
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
import { AUTO_DEFAULT_GROUP_NAME, RuleExecutionChannel } from '@req-freedom/shared';
import type { Rule, RuleGroup } from '@req-freedom/shared';
import { getEnabled, getGroups, saveConfiguration, saveGroups } from '@/utils/storage';
import {
  createConfigurationExport,
  getConfigurationExportFileName,
  parseConfigurationExport,
} from '@/utils/config-transfer';
import { createRuleGroup, createSampleRule } from '@/utils/factories';
import { RULE_ACTION_TYPE_LABELS, RULE_SCOPE_TYPE_LABELS } from '@/utils/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import RuleEditor from './RuleEditor';
import {
  GROUP_SORT,
  GROUP_VIEW,
  RULE_STATUS_FILTER,
  ManagementStatistics,
  OptionsPageHeader,
  RuleManagementToolbar,
} from './ManagementDashboard';
import type { GroupSort, GroupView, RuleStatusFilter } from './ManagementDashboard';

/**
 * 规则「表头」与「数据行」共用的网格列模板，保证列对齐。
 *
 * 用 div + CSS Grid 而非原生 <table>：浏览器对 display:table-row 元素的 transform 过渡渲染不可靠，
 * 会导致 dnd-kit 排序时「瞬间换位、无让位动画」；block/grid 布局才能让排序动画稳定生效。
 * 列依次为：拖拽柄 · 启用 · 名称 · 类型 · 匹配方式 · 匹配内容 · 操作。
 *
 * 「类型」「匹配方式」「操作」使用固定宽度，名称与匹配内容按比例分配余宽；不能使用 auto，
 * 否则每一行会按自身内容分别计算列宽，导致表头和规则内容无法左对齐。
 */
const RULE_ROW_GRID =
  'grid grid-cols-[28px_44px_minmax(0,1.3fr)_100px_minmax(0,1fr)_72px] items-center gap-3';

/**
 * 无分组时新建规则用的「默认分组」占位 ID。
 *
 * 只在类型选择器 / 规则编辑器里临时代表一个尚未创建的默认分组；只有在规则真正保存时才落地建组，
 * 中途取消则不产生空的默认分组。
 */
const DEFAULT_GROUP_SENTINEL = '__req-freedom:default-group__';

/** 「最近修改」视图默认展示的分组上限。 */
const RECENT_GROUP_LIMIT = 5;

/**
 * 规则类型对应的柔和标签颜色：15% 色底 + 随明暗翻转的强调文字（--accent-* 见 style.css），
 * 浅色/深色两套下都保证对比度与扫读性。
 */
const CHANNEL_BADGE_CLASS: Record<RuleExecutionChannel, string> = {
  [RuleExecutionChannel.Dnr]: 'bg-cyan-500/15 text-[var(--accent-cyan)]',
  [RuleExecutionChannel.PagePatch]: 'bg-violet-500/15 text-[var(--accent-violet)]',
};

/**
 * 作用域徽标：规则限定了生效范围（非全部标签页）时展示，提示这条规则只在部分标签生效。
 * @param scope 规则作用域（缺省表示全部标签页，不展示徽标）
 */
function ScopeBadge({ scope }: { scope: Rule['scope'] }) {
  if (!scope) {
    return null;
  }
  return (
    <Badge
      variant="secondary"
      className="shrink-0 border-transparent bg-amber-500/15 text-[var(--accent-amber)]"
      title={`${RULE_SCOPE_TYPE_LABELS[scope.type]} · ${scope.targets.length} 个对象`}
    >
      {RULE_SCOPE_TYPE_LABELS[scope.type]}
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
 * @param updatedAt 分组最近更新时间
 * @returns 便于快速扫读的相对时间文案
 */
function formatRelativeTime(updatedAt: string): string {
  /** 解析后的时间戳。 */
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return '暂无记录';
  }
  /** 当前时间与目标时间的分钟差，未来时间按刚刚处理。 */
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) {
    return '刚刚更新';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} 分钟前更新`;
  }
  /** 当前时间与目标时间的小时差。 */
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} 小时前更新`;
  }
  /** 当前时间与目标时间的天数差。 */
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} 天前更新`;
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
      placeholder="分组名称"
    />
  );
}

interface SortableRuleRowProps {
  /** 行对应的规则 */
  rule: Rule;
  /** 切换启用状态回调 */
  onToggle: (id: string) => void;
  /** 进入编辑回调 */
  onEdit: (rule: Rule) => void;
  /** 删除回调 */
  onDelete: (id: string) => void;
}

/**
 * 可拖拽排序的规则行（div + Grid 实现，保证 dnd-kit 排序动画顺滑）
 */
function SortableRuleRow({ rule, onToggle, onEdit, onDelete }: SortableRuleRowProps) {
  /** dnd-kit 排序钩子：提供拖拽句柄监听、位移与拖拽态 */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // 拖拽中原行完全透明留出空位，跟随光标的是 DragOverlay 里的副本
      className={`${RULE_ROW_GRID} group border-t border-border/80 px-4 py-2.5 transition-colors hover:bg-primary/[0.03] ${
        isDragging ? 'opacity-0' : ''
      }`}
    >
      {/* 拖拽句柄 */}
      <button
        type="button"
        className="flex cursor-grab touch-none items-center justify-center rounded p-1 text-muted-foreground opacity-50 transition-opacity hover:opacity-100 active:cursor-grabbing"
        title="拖拽排序"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Switch checked={rule.enabled} onCheckedChange={() => onToggle(rule.id)} />
      {/* 长名字截断，避免撑宽行挤压其他列 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium" title={rule.name}>
          {rule.name}
        </span>
        <ScopeBadge scope={rule.scope} />
      </div>
      <Badge variant="secondary" className={`justify-self-start whitespace-nowrap border-transparent ${CHANNEL_BADGE_CLASS[rule.channel]}`}>
        {rule.channel === RuleExecutionChannel.Dnr ? 'DNR' : '页面补丁'}
      </Badge>
      <code
        className="min-w-0 max-w-full justify-self-start truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
        title={`${rule.pattern} · ${rule.actions.map((action) => RULE_ACTION_TYPE_LABELS[action.type]).join('、')}`}
      >
        {rule.pattern} · {rule.actions.map((action) => RULE_ACTION_TYPE_LABELS[action.type]).join('、')}
      </code>
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="编辑"
          onClick={() => onEdit(rule)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          title="删除"
          onClick={() => onDelete(rule.id)}
        >
          <Trash2 className="size-4" />
        </Button>
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
  /** 向分组内新增规则（打开类型选择器） */
  onAddRule: (groupId: string) => void;
  /** 切换组内单条规则启用状态 */
  onToggleRule: (ruleId: string) => void;
  /** 编辑组内规则 */
  onEditRule: (rule: Rule) => void;
  /** 删除组内规则 */
  onDeleteRule: (ruleId: string) => void;
  /** 组内规则重排后的回调（传入重排后的规则列表） */
  onReorderRules: (groupId: string, nextRules: Rule[]) => void;
  /** 是否折叠（折叠后隐藏组内规则列表） */
  collapsed: boolean;
  /** 切换折叠状态 */
  onToggleCollapse: (groupId: string) => void;
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
  onToggleRule,
  onEditRule,
  onDeleteRule,
  onReorderRules,
  collapsed,
  onToggleCollapse,
}: SortableGroupCardProps) {
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
        <button
          type="button"
          className="flex cursor-grab touch-none items-center justify-center rounded p-1 text-muted-foreground opacity-50 transition-opacity hover:opacity-100 active:cursor-grabbing"
          title="拖拽排序分组"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={collapsed ? '展开' : '折叠'}
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
          title={group.enabled ? '整组停用' : '整组启用'}
        />
        <GroupNameInput value={group.name} onCommit={(name) => onRenameGroup(group.id, name)} />
        <Badge variant="secondary" className="shrink-0 border-transparent bg-primary/10 text-primary">
          {group.rules.length} 条规则
        </Badge>
        <Badge
          variant="secondary"
          className={`shrink-0 border-transparent ${
            group.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          }`}
        >
          {group.enabled ? '启用中' : '已停用'}
        </Badge>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          最近更新 {formatRelativeTime(group.updatedAt)}
        </span>
        <Button size="sm" className="shrink-0" onClick={() => onAddRule(group.id)}>
          <Plus />
          添加规则
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          title="删除分组"
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
            该分组暂无规则，点击右上角「添加规则」创建
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
                    onToggle={onToggleRule}
                    onEdit={onEditRule}
                    onDelete={onDeleteRule}
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
  return (
    <div className={`${RULE_ROW_GRID} bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground`}>
      <span />
      <span className="whitespace-nowrap">启用</span>
      <span className="whitespace-nowrap">名称</span>
      <span className="whitespace-nowrap">执行通道</span>
      <span className="whitespace-nowrap">匹配内容 · 动作</span>
      <span className="whitespace-nowrap text-right">操作</span>
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
    <div className={`${RULE_ROW_GRID} px-3 py-2`}>
      <span className="flex items-center justify-center p-1 text-muted-foreground opacity-50">
        <GripVertical className="size-4" />
      </span>
      <Switch checked={rule.enabled} onCheckedChange={() => {}} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium" title={rule.name}>
          {rule.name}
        </span>
        <ScopeBadge scope={rule.scope} />
      </div>
      <Badge variant="secondary" className={`justify-self-start whitespace-nowrap border-transparent ${CHANNEL_BADGE_CLASS[rule.channel]}`}>
        {rule.channel === RuleExecutionChannel.Dnr ? 'DNR' : '页面补丁'}
      </Badge>
      <code
        className="min-w-0 max-w-full justify-self-start truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
        title={`${rule.pattern} · ${rule.actions.map((action) => RULE_ACTION_TYPE_LABELS[action.type]).join('、')}`}
      >
        {rule.pattern} · {rule.actions.map((action) => RULE_ACTION_TYPE_LABELS[action.type]).join('、')}
      </code>
      <div className="flex justify-end gap-1 text-muted-foreground">
        <span className="flex size-8 items-center justify-center">
          <Pencil className="size-4" />
        </span>
        <span className="flex size-8 items-center justify-center">
          <Trash2 className="size-4" />
        </span>
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

/**
 * Options 主界面：规则分组的增删改、启停与组内规则拖拽排序
 */
export default function App() {
  /** 规则分组列表 */
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  /** 规则编辑对话框状态，null 表示关闭 */
  const [ruleDialog, setRuleDialog] = useState<RuleDialogState | null>(null);
  /** 当前正在拖拽的分组 ID，用于渲染外层分组 DragOverlay 预览 */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  /** 已折叠的分组 ID 集合（纯视图状态，不写入 storage，避免无谓触发规则重同步） */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  /** 导入 / 导出结果的就地提示。 */
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  /** 隐藏的 JSON 文件选择框，用按钮触发以保持工具栏布局统一。 */
  const importInputRef = useRef<HTMLInputElement>(null);
  /** 搜索分组名、规则名与匹配内容的关键词。 */
  const [searchQuery, setSearchQuery] = useState('');
  /** 分组启用状态筛选。 */
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>(RULE_STATUS_FILTER.All);
  /** 规则执行通道筛选。 */
  const [channelFilter, setChannelFilter] = useState<RuleExecutionChannel | 'all'>('all');
  /** 分组的派生展示排序方式。 */
  const [groupSort, setGroupSort] = useState<GroupSort>(GROUP_SORT.UpdatedAt);
  /** 当前激活的分组视图。 */
  const [groupView, setGroupView] = useState<GroupView>(GROUP_VIEW.All);

  // 初始加载分组
  useEffect(() => {
    void getGroups().then(setGroups);
  }, []);

  /** 分组列表拖拽用的传感器（与各分组内规则列表的传感器相互独立） */
  const groupSensors = useSortableSensors();

  /**
   * 更新分组列表并持久化
   * @param next 新的分组列表
   * @param updatedGroupIds 需要刷新最近更新时间的分组 ID
   */
  const persist = async (next: RuleGroup[], updatedGroupIds: readonly string[] = []): Promise<void> => {
    /** 本次操作发生时刻，用于统一更新受影响分组的摘要时间。 */
    const updatedAt = new Date().toISOString();
    /** 需要写入最新更新时间的分组 ID。 */
    const updatedGroupIdSet = new Set(updatedGroupIds);
    /** 已附带最新更新时间的持久化数据。 */
    const groupsWithUpdatedAt = next.map((group) =>
      updatedGroupIdSet.has(group.id) ? { ...group, updatedAt } : group,
    );
    setGroups(groupsWithUpdatedAt);
    await saveGroups(groupsWithUpdatedAt);
  };

  // ---------- 分组操作 ----------

  /**
   * 新建一个空分组并追加到末尾
   */
  const handleAddGroup = (): void => {
    void persist([...groups, createRuleGroup()]);
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
      setTransferMessage('配置已导出。');
    } catch {
      setTransferMessage('导出失败，请重试。');
    }
  };

  /**
   * 打开 JSON 文件选择框。
   */
  const handleImportClick = (): void => {
    importInputRef.current?.click();
  };

  /**
   * 读取、校验并整体替换当前配置。
   * @param event 文件选择事件
   */
  const handleImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    /** 用户刚选择的配置文件。 */
    const file = event.target.files?.[0];
    // 允许用户连续选择同一文件再次导入。
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      /** 文件中的原始 JSON 文本。 */
      const content = await file.text();
      /** 已通过结构与 schema 校验的配置。 */
      const configuration = parseConfigurationExport(content);
      /** 导入配置中包含的规则总数。 */
      const ruleCount = configuration.groups.reduce((count, group) => count + group.rules.length, 0);
      if (
        !window.confirm(
          `将导入 ${configuration.groups.length} 个分组、${ruleCount} 条规则，并替换当前全部配置。确定继续吗？`,
        )
      ) {
        return;
      }
      await saveConfiguration(configuration.groups, configuration.enabled);
      setGroups(configuration.groups);
      setCollapsedGroupIds(new Set());
      setTransferMessage(`已导入 ${configuration.groups.length} 个分组、${ruleCount} 条规则。`);
    } catch (error) {
      /** 便于用户定位问题的导入错误。 */
      const message = error instanceof Error ? error.message : '导入失败，请确认文件内容后重试。';
      setTransferMessage(`导入失败：${message}`);
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
    void persist(
      groups.map((group) => (group.id === id ? { ...group, enabled: !group.enabled } : group)),
      [id],
    );
  };

  /**
   * 重命名分组
   * @param id 分组 ID
   * @param name 新名称
   */
  const handleRenameGroup = (id: string, name: string): void => {
    void persist(groups.map((group) => (group.id === id ? { ...group, name } : group)), [id]);
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
      if (!window.confirm(`分组「${target.name}」下还有 ${target.rules.length} 条规则，确定要删除整组吗？`)) {
        return;
      }
    }
    void persist(groups.filter((group) => group.id !== id));
  };

  // ---------- 规则操作 ----------

  /**
   * 直接打开统一规则编辑器，准备向指定分组新增规则
   * @param groupId 目标分组 ID
   */
  const handleAddRule = (groupId: string): void => {
    setRuleDialog({ groupId, rule: createSampleRule(), isNew: true });
  };

  /**
   * 无分组时直接新建规则：以「默认分组」占位打开编辑器，保存时才真正建组
   */
  const handleAddFirstRule = (): void => {
    setRuleDialog({ groupId: DEFAULT_GROUP_SENTINEL, rule: createSampleRule(), isNew: true });
  };

  /**
   * 打开规则编辑器编辑已有规则
   * @param rule 目标规则
   */
  const handleEditRule = (rule: Rule): void => {
    /** 规则所属分组 */
    const owner = groups.find((group) => group.rules.some((item) => item.id === rule.id));
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
      void persist([...groups, { ...createRuleGroup(AUTO_DEFAULT_GROUP_NAME), rules: [rule] }]);
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
    const sourceGroupId = groups.find((group) =>
      group.rules.some((item) => item.id === rule.id),
    )?.id;
    /** 本次需要更新时间的分组 ID。 */
    const updatedGroupIds = sourceGroupId
      ? [sourceGroupId, targetGroupId]
      : [targetGroupId];
    void persist(next, updatedGroupIds);
    setRuleDialog(null);
  };

  /**
   * 删除规则
   * @param ruleId 规则 ID
   */
  const handleDeleteRule = (ruleId: string): void => {
    /** 被删除规则原本所属的分组。 */
    const ownerGroupId = groups.find((group) => group.rules.some((rule) => rule.id === ruleId))?.id;
    void persist(
      groups.map((group) => ({
        ...group,
        rules: group.rules.filter((rule) => rule.id !== ruleId),
      })),
      ownerGroupId ? [ownerGroupId] : [],
    );
  };

  /**
   * 切换单条规则启用状态
   * @param ruleId 规则 ID
   */
  const handleToggleRule = (ruleId: string): void => {
    /** 被切换规则所属的分组。 */
    const ownerGroupId = groups.find((group) => group.rules.some((rule) => rule.id === ruleId))?.id;
    void persist(
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
   * 组内规则重排后写回对应分组
   * @param groupId 分组 ID
   * @param nextRules 重排后的组内规则
   */
  const handleReorderRules = (groupId: string, nextRules: Rule[]): void => {
    void persist(
      groups.map((group) => (group.id === groupId ? { ...group, rules: nextRules } : group)),
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
    void persist(arrayMove(groups, oldIndex, newIndex), [String(active.id), String(over.id)]);
  };

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
    /** 不变更原始数组的排序副本。 */
    const sortedGroups = [...filteredGroups].sort((first, second) => {
      if (groupSort === GROUP_SORT.Name) {
        return first.name.localeCompare(second.name, 'zh-CN');
      }
      return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    });
    return groupView === GROUP_VIEW.RecentlyUpdated
      ? sortedGroups.slice(0, RECENT_GROUP_LIMIT)
      : groupView === GROUP_VIEW.Enabled
        ? sortedGroups.filter((group) => group.enabled)
        : sortedGroups;
  }, [channelFilter, groupSort, groupView, groups, normalizedSearchQuery, statusFilter]);

  /** 供编辑器「所属分组」下拉使用的分组精简信息 */
  const groupOptions = groups.map((group) => ({ id: group.id, name: group.name }));
  /** 传给编辑器的分组选项：向「默认分组」新建首条规则时注入一个占位选项供下拉展示 */
  const editorGroupOptions =
    ruleDialog?.groupId === DEFAULT_GROUP_SENTINEL
      ? [{ id: DEFAULT_GROUP_SENTINEL, name: AUTO_DEFAULT_GROUP_NAME }, ...groupOptions]
      : groupOptions;
  /** 正在拖拽的分组，用于外层 DragOverlay 预览 */
  const activeGroup = activeGroupId
    ? groups.find((group) => group.id === activeGroupId)
    : undefined;

  return (
    <div className="min-h-screen">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void handleImport(event)}
      />
      <OptionsPageHeader
        showAddGroup={groups.length > 0}
        onAddGroup={handleAddGroup}
        onImport={handleImportClick}
        onExport={() => void handleExport()}
      />

      <main className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
        {groups.length > 0 && (
          <>
            <ManagementStatistics
              groupCount={groups.length}
              ruleCount={totalRuleCount}
              enabledRuleCount={enabledRuleCount}
            />
            <RuleManagementToolbar
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              channelFilter={channelFilter}
              onChannelFilterChange={setChannelFilter}
              sort={groupSort}
              onSortChange={setGroupSort}
              view={groupView}
              onViewChange={setGroupView}
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
              <p className="text-sm font-medium">还没有规则</p>
              <p className="mt-1 text-xs text-muted-foreground">
                直接新建规则即可，会自动归入「{AUTO_DEFAULT_GROUP_NAME}」；也可先建分组再收纳
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddFirstRule}>
                <Plus />
                新建规则
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddGroup}>
                <FolderPlus />
                新建分组
              </Button>
            </div>
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <p className="text-sm font-medium">没有找到匹配的规则分组</p>
            <p className="text-xs text-muted-foreground">调整搜索或筛选条件后再试</p>
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
                    onToggleRule={handleToggleRule}
                    onEditRule={handleEditRule}
                    onDeleteRule={handleDeleteRule}
                    onReorderRules={handleReorderRules}
                    collapsed={collapsedGroupIds.has(group.id)}
                    onToggleCollapse={handleToggleCollapse}
                  />
                ))}
              </div>
            </SortableContext>

            {/* 分组拖拽预览：轻量副本跟随光标，真实卡片淡化为占位 */}
            <DragOverlay>{activeGroup ? <GroupCardOverlay group={activeGroup} /> : null}</DragOverlay>
          </DndContext>
        )}
      </main>

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
    </div>
  );
}
