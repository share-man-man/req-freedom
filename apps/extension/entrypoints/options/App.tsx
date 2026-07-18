import { useEffect, useState } from 'react';
import {
  Ban,
  Clock,
  Code2,
  FileJson,
  Forward,
  GripVertical,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Rule } from '@req-freedom/shared';
import {
  DEFAULT_MOCK_STATUS,
  HeaderOperation,
  HeaderTarget,
  InsertScriptCodeType,
  InsertScriptTiming,
  MatchType,
  RuleType,
} from '@req-freedom/shared';
import { getRules, saveRules } from '@/utils/storage';
import { MATCH_TYPE_LABELS, RULE_TYPE_LABELS } from '@/utils/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import RuleEditor from './RuleEditor';

/** 每种规则类型对应的图标（工具栏按钮复用） */
const RULE_TYPE_ICONS: Record<RuleType, ReactNode> = {
  [RuleType.Block]: <Ban />,
  [RuleType.Redirect]: <Forward />,
  [RuleType.InjectParams]: <SlidersHorizontal />,
  [RuleType.ModifyHeaders]: <Pencil />,
  [RuleType.MockResponse]: <FileJson />,
  [RuleType.Delay]: <Clock />,
  [RuleType.InsertScript]: <Code2 />,
};

/**
 * 吸附「操作」列的样式：贴右吸附 + 不透明背景遮挡滚动内容 + hover 保持不透明，
 * 仅当表格横向溢出（容器带 data-overflow-x）时在左缘投出向左渐隐的渐变阴影。
 */
const STICKY_ACTION_CLASS =
  'req-sticky-shadow sticky right-0 bg-card group-hover:bg-muted';

/**
 * 按规则类型生成一条示例规则（作为新建规则的模板）
 * @param type 规则类型
 * @returns 预填充好的新规则
 */
function createSampleRule(type: RuleType): Rule {
  /** 所有规则共享的基础字段 */
  const base = {
    id: crypto.randomUUID(),
    name: `${RULE_TYPE_LABELS[type]}规则`,
    // 新建即启用：用户建规则通常就是要用它，少一步手动开启
    enabled: true,
    matchType: MatchType.Contains,
    pattern: 'example.com/api',
  };

  switch (type) {
    case RuleType.Block:
      return { ...base, type };
    case RuleType.Redirect:
      return { ...base, type, redirectUrl: 'http://localhost:3000/api' };
    case RuleType.InjectParams:
      return { ...base, type, params: { debug: '1' } };
    case RuleType.ModifyHeaders:
      return {
        ...base,
        type,
        headers: [
          {
            target: HeaderTarget.Request,
            operation: HeaderOperation.Set,
            header: 'X-Req-Freedom',
            value: '1',
          },
        ],
      };
    case RuleType.MockResponse:
      return {
        ...base,
        type,
        statusCode: DEFAULT_MOCK_STATUS,
        body: JSON.stringify({ code: 0, data: 'mocked by req-freedom' }),
      };
    case RuleType.Delay:
      return { ...base, type, delayMs: 2000 };
    case RuleType.InsertScript:
      return {
        ...base,
        // 注入按页面 URL 命中，示例默认匹配整个站点
        pattern: 'example.com',
        type,
        codeType: InsertScriptCodeType.JavaScript,
        timing: InsertScriptTiming.DocumentEnd,
        code: "console.log('injected by req-freedom');",
      };
  }
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
 * 可拖拽排序的规则表格行
 */
function SortableRuleRow({ rule, onToggle, onEdit, onDelete }: SortableRuleRowProps) {
  /** dnd-kit 排序钩子：提供拖拽句柄监听、位移与拖拽态 */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group border-b border-border transition-colors hover:bg-muted ${
        isDragging ? 'relative z-10 bg-card shadow-lg' : ''
      }`}
    >
      {/* 拖拽句柄 */}
      <TableCell className="w-8 pr-0">
        <button
          type="button"
          className="flex cursor-grab touch-none items-center justify-center rounded p-1 text-muted-foreground opacity-50 transition-opacity hover:opacity-100 active:cursor-grabbing"
          title="拖拽排序"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </TableCell>
      <TableCell>
        <Switch checked={rule.enabled} onCheckedChange={() => onToggle(rule.id)} />
      </TableCell>
      <TableCell className="font-medium">
        {/* 长名字截断，避免撑宽表格挤压其他列 */}
        <div className="max-w-[240px] truncate" title={rule.name}>
          {rule.name}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="whitespace-nowrap">
          {RULE_TYPE_LABELS[rule.type]}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {MATCH_TYPE_LABELS[rule.matchType]}
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {rule.pattern}
        </code>
      </TableCell>
      <TableCell className={STICKY_ACTION_CLASS}>
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
      </TableCell>
    </tr>
  );
}

/**
 * Options 主界面：规则的增删改、启停与拖拽排序
 */
export default function App() {
  /** 规则列表 */
  const [rules, setRules] = useState<Rule[]>([]);
  /** 对话框中正在编辑/新建的规则草稿，null 表示对话框关闭 */
  const [dialogRule, setDialogRule] = useState<Rule | null>(null);
  /** 当前对话框是否为「新建」（决定保存时是追加还是替换） */
  const [isNewRule, setIsNewRule] = useState(false);

  // 初始加载规则
  useEffect(() => {
    void getRules().then(setRules);
  }, []);

  /** 拖拽传感器：移动超过 5px 才激活，避免影响开关/按钮点击 */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /**
   * 更新规则列表并持久化
   * @param next 新的规则列表
   */
  const updateRules = async (next: Rule[]): Promise<void> => {
    setRules(next);
    await saveRules(next);
  };

  /**
   * 打开对话框新建一条指定类型的规则（保存前不写入列表）
   * @param type 规则类型
   */
  const handleAdd = (type: RuleType): void => {
    setDialogRule(createSampleRule(type));
    setIsNewRule(true);
  };

  /**
   * 打开对话框编辑已有规则
   * @param rule 目标规则
   */
  const handleEdit = (rule: Rule): void => {
    setDialogRule(rule);
    setIsNewRule(false);
  };

  /**
   * 关闭对话框，丢弃未保存的草稿
   */
  const closeDialog = (): void => {
    setDialogRule(null);
  };

  /**
   * 保存对话框结果：新建则追加，编辑则替换，然后关闭
   * @param next 编辑后的规则
   */
  const handleSave = (next: Rule): void => {
    void updateRules(
      isNewRule ? [...rules, next] : rules.map((rule) => (rule.id === next.id ? next : rule)),
    );
    closeDialog();
  };

  /**
   * 删除规则
   * @param id 规则 ID
   */
  const handleDelete = (id: string): void => {
    void updateRules(rules.filter((rule) => rule.id !== id));
  };

  /**
   * 切换规则启用状态
   * @param id 规则 ID
   */
  const handleToggle = (id: string): void => {
    void updateRules(
      rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)),
    );
  };

  /**
   * 拖拽结束：按落点重排规则顺序并持久化
   * @param event dnd-kit 拖拽结束事件
   */
  const handleDragEnd = (event: DragEndEvent): void => {
    /** 拖起项与落点项 */
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    /** 拖起项原下标 */
    const oldIndex = rules.findIndex((rule) => rule.id === active.id);
    /** 落点项下标 */
    const newIndex = rules.findIndex((rule) => rule.id === over.id);
    void updateRules(arrayMove(rules, oldIndex, newIndex));
  };

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-6 py-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Zap className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Req Freedom 规则管理</h1>
            <p className="text-xs text-muted-foreground">
              拦截 · 重定向 · 参数注入 · Header · Mock · 延迟 · 脚本注入
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {/* 工具栏：新建各类型规则 */}
        <section className="mb-5">
          <p className="mb-2 text-sm font-medium text-muted-foreground">新建规则</p>
          <div className="flex flex-wrap gap-2">
            {Object.values(RuleType).map((type) => (
              <Button key={type} variant="outline" size="sm" onClick={() => handleAdd(type)}>
                {RULE_TYPE_ICONS[type]}
                {RULE_TYPE_LABELS[type]}
              </Button>
            ))}
          </div>
        </section>

        {/* 规则列表（支持拖拽排序） */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead className="w-14 whitespace-nowrap">启用</TableHead>
                  <TableHead className="whitespace-nowrap">名称</TableHead>
                  <TableHead className="whitespace-nowrap">类型</TableHead>
                  <TableHead className="whitespace-nowrap">匹配方式</TableHead>
                  <TableHead className="whitespace-nowrap">匹配内容</TableHead>
                  <TableHead className="req-sticky-shadow sticky right-0 w-28 whitespace-nowrap bg-card text-right">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      暂无规则，点击上方按钮创建
                    </TableCell>
                  </TableRow>
                )}
                <SortableContext
                  items={rules.map((rule) => rule.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {rules.map((rule) => (
                    <SortableRuleRow
                      key={rule.id}
                      rule={rule}
                      onToggle={handleToggle}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </main>

      {/* 新建 / 编辑规则对话框 */}
      <Dialog open={dialogRule !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent
          className="max-w-2xl"
          // 点击遮罩不关闭，避免长表单编辑到一半误触丢失（仍可用关闭按钮或 Esc 退出）
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {dialogRule && (
            <RuleEditor
              // key 保证切换编辑对象时重建草稿状态
              key={dialogRule.id}
              rule={dialogRule}
              isNew={isNewRule}
              onSave={handleSave}
              onCancel={closeDialog}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
