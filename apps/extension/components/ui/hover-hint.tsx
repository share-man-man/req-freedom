import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** 气泡相对视口的定位信息。 */
interface HintPosition {
  /** 气泡右边缘距视口右侧的距离（px）。 */
  right: number;
  /** 气泡贴合边（上方时为距视口底部，下方时为距视口顶部）的距离（px）。 */
  offset: number;
  /** 气泡出现在触发器的上方还是下方。 */
  placement: 'top' | 'bottom';
}

/** HoverHint 组件属性。 */
interface HoverHintProps {
  /** 气泡内容。 */
  content: ReactNode;
  /** 触发器内容，通常是一个状态图标。 */
  children: ReactNode;
  /** 无障碍名称，同时作为触发器的 `aria-label`。 */
  label: string;
  /** 附加到触发器的样式类。 */
  className?: string;
  /** 附加到气泡本体的样式类，用于调整宽度或配色。 */
  contentClassName?: string;
}

/** 触发器与气泡之间的间距（px）。 */
const HINT_GAP = 6;

/**
 * 悬停气泡：包裹任意触发器，鼠标悬停或键盘聚焦时浮出说明文字。
 *
 * 气泡用 `position: fixed` 并在展开时按触发器位置实时计算坐标，因此不会被
 * popup 里 `overflow-y-auto` 的滚动容器裁掉；触发器落在视口下半部分时气泡自动朝上，
 * 避免被 popup 窗口下边缘截断。滚动会让已计算的坐标失效，故滚动时直接收起。
 * @param props 气泡内容、触发器内容与样式类
 */
export function HoverHint({ content, children, label, className, contentClassName }: HoverHintProps) {
  /** 气泡节点 ID，供 aria-describedby 关联。 */
  const bubbleId = useId();
  /** 触发器节点引用，用于读取其视口坐标。 */
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 当前气泡定位；为 null 表示气泡收起。 */
  const [position, setPosition] = useState<HintPosition | null>(null);

  /**
   * 按触发器当前位置展开气泡。
   */
  const openHint = (): void => {
    /** 触发器在视口中的位置。 */
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    // 触发器在视口下半部分时朝上展开，避免气泡越出 popup 窗口
    const placement = rect.bottom > window.innerHeight / 2 ? 'top' : 'bottom';
    setPosition({
      right: Math.max(window.innerWidth - rect.right, 0),
      offset:
        placement === 'top' ? window.innerHeight - rect.top + HINT_GAP : rect.bottom + HINT_GAP,
      placement,
    });
  };

  /**
   * 收起气泡。
   */
  const closeHint = (): void => setPosition(null);

  // 滚动会让已算好的 fixed 坐标与触发器脱节，展开期间一旦滚动就收起
  useEffect(() => {
    if (!position) {
      return undefined;
    }
    window.addEventListener('scroll', closeHint, true);
    return () => window.removeEventListener('scroll', closeHint, true);
  }, [position]);

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      aria-describedby={position ? bubbleId : undefined}
      className={cn('relative inline-flex shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      onMouseEnter={openHint}
      onMouseLeave={closeHint}
      onFocus={openHint}
      onBlur={closeHint}
    >
      {children}
      {position && (
        <span
          id={bubbleId}
          role="tooltip"
          style={{
            right: position.right,
            ...(position.placement === 'top'
              ? { bottom: position.offset }
              : { top: position.offset }),
          }}
          className={cn(
            'pointer-events-none fixed z-50 w-56 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-popover-foreground shadow-md',
            contentClassName,
          )}
        >
          {content}
        </span>
      )}
    </button>
  );
}
