import type { HTMLAttributes, Ref } from 'react';
import { cn } from '@/utils/cn';

/** 卡片容器属性：原生 div 属性 + 可选 ref（React 19 ref 作为普通 prop 透传） */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 根元素 ref，供拖拽排序等场景绑定节点 */
  ref?: Ref<HTMLDivElement>;
}

/**
 * 卡片容器
 * @param props 原生 div 属性（含可选 ref）
 */
export function Card({ className, ref, ...props }: CardProps) {
  return (
    <div
      ref={ref}
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
