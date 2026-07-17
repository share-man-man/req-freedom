import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

/** 对话框根容器（受控 open / onOpenChange 由 Radix 处理） */
export const Dialog = DialogPrimitive.Root;
/** 对话框触发器 */
export const DialogTrigger = DialogPrimitive.Trigger;
/** 对话框关闭按钮包装（asChild 透传） */
export const DialogClose = DialogPrimitive.Close;

/**
 * 对话框内容（含遮罩层、居中卡片、右上角关闭按钮）
 * @param props Radix Content 原生属性
 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * 对话框头部（标题区，固定在顶部）
 * @param props 原生 div 属性
 */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-row items-center gap-2 border-b border-border px-5 py-4', className)}
      {...props}
    />
  );
}

/**
 * 对话框标题
 * @param props Radix Title 原生属性
 */
export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

/**
 * 对话框底部（操作按钮区，固定在底部）
 * @param props 原生 div 属性
 */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}
