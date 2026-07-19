import {
  Ban,
  Clock,
  Code2,
  FileCog,
  FileJson,
  Forward,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { RuleType } from '@req-freedom/shared';
import { RULE_TYPE_LABELS, RULE_TYPE_SCOPE_HINTS } from '@/utils/labels';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** 每种规则类型对应的图标 */
export const RULE_TYPE_ICONS: Record<RuleType, ReactNode> = {
  [RuleType.Block]: <Ban />,
  [RuleType.Redirect]: <Forward />,
  [RuleType.InjectParams]: <SlidersHorizontal />,
  [RuleType.ModifyHeaders]: <Pencil />,
  [RuleType.MockResponse]: <FileJson />,
  [RuleType.Delay]: <Clock />,
  [RuleType.InsertScript]: <Code2 />,
  [RuleType.ModifyRequestBody]: <FileCog />,
};

interface RuleTypePickerProps {
  /** 目标分组名称，用于标题提示规则将被加入哪个分组 */
  groupName: string;
  /** 选中某个规则类型的回调 */
  onPick: (type: RuleType) => void;
}

/**
 * 规则类型选择器（对话框内容）：新建规则前先选类型，每种类型附一句说明，降低选择成本
 * @param groupName 目标分组名称
 * @param onPick 选中类型回调
 */
export default function RuleTypePicker({ groupName, onPick }: RuleTypePickerProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>新建规则</DialogTitle>
        <p className="text-sm text-muted-foreground">
          将添加到分组「{groupName}」，请选择规则类型
        </p>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-3 overflow-y-auto px-5 py-4">
        {Object.values(RuleType).map((type) => (
          <button
            key={type}
            type="button"
            className="glow-surface glow-surface--hover flex items-start gap-3 rounded-lg border border-border bg-secondary p-4 text-left transition-colors hover:bg-accent"
            onClick={() => onPick(type)}
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
              {RULE_TYPE_ICONS[type]}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{RULE_TYPE_LABELS[type]}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                {RULE_TYPE_SCOPE_HINTS[type]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
