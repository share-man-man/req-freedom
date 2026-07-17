import type { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

/**
 * 卡片容器
 * @param props 原生 div 属性
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 卡片头部
 * @param props 原生 div 属性
 */
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

/**
 * 卡片标题
 * @param props 原生标题属性
 */
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />
  );
}

/**
 * 卡片正文
 * @param props 原生 div 属性
 */
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
