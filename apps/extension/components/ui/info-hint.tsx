import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';

/** InfoHint 组件属性。 */
interface InfoHintProps {
  /** 气泡内容。 */
  children: ReactNode;
  /** 附加到触发器的样式类（如需要 `shrink-0` 时传入）。 */
  className?: string;
  /** 附加到气泡本体的样式类，用于调整宽度或内部间距。 */
  contentClassName?: string;
}

/**
 * 信息气泡：一个 info 小图标，悬停或键盘聚焦时在其下方浮出说明文字。
 *
 * 触发器是真正的 `<button>`，因此不能放在另一个按钮内部——按钮嵌套按钮是非法结构。
 * 使用处若本身是可点击行，需把本组件拆成该按钮的兄弟节点。
 * 气泡就地 absolute 定位，故使用处需保证外层 DOM 不裁剪溢出。
 *
 * 无障碍：按钮以 `aria-label` 提供名称、以 `aria-describedby` 关联气泡文本，键盘聚焦（focus-visible）
 * 与鼠标悬停都会显示气泡；图标本身对辅助技术隐藏。
 * @param props 气泡内容与样式类
 */
export function InfoHint({ children, className, contentClassName }: InfoHintProps) {
  const { t } = useTranslation();
  /** 气泡节点 ID，供 aria-describedby 关联。 */
  const bubbleId = useId();
  return (
    <button
      type="button"
      aria-label={t('infoHint.trigger')}
      aria-describedby={bubbleId}
      className={cn(
        'group/info-hint relative inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Info aria-hidden="true" className="size-3" />
      <span
        id={bubbleId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/info-hint:opacity-100 group-focus-visible/info-hint:opacity-100',
          contentClassName,
        )}
      >
        {children}
      </span>
    </button>
  );
}
