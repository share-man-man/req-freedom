import { useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

/**
 * 表格容器（含横向滚动）
 *
 * 检测内容是否横向溢出，并在滚动容器上写 data-overflow-x 标记；
 * 吸附列（sticky）据此决定是否显示左缘渐变阴影，暗示下方还有被遮挡的内容。
 * @param props 原生 table 属性
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  /** 横向滚动容器引用 */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 是否横向溢出（决定吸附列阴影的显隐） */
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    /** 滚动容器 DOM */
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    /** 重新计算是否横向溢出（留 1px 容差避免亚像素抖动） */
    const update = (): void => setOverflowing(el.scrollWidth - el.clientWidth > 1);
    update();
    // 容器尺寸与表格内容宽度变化都可能改变溢出状态，两者都观察
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      data-overflow-x={overflowing ? 'true' : undefined}
      className="relative w-full overflow-x-auto"
    >
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

/**
 * 表头
 * @param props 原生 thead 属性
 */
export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

/**
 * 表体
 * @param props 原生 tbody 属性
 */
export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

/**
 * 表格行
 * @param props 原生 tr 属性
 */
export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-accent',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 表头单元格
 * @param props 原生 th 属性
 */
export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 表体单元格
 * @param props 原生 td 属性
 */
export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
