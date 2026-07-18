import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * 自增高模式：内容少时呈现为单行（与 Input 等高），内容变长时自动向下扩展。
   * 依赖 CSS field-sizing，Chrome/Edge 123+ 原生支持，适合正则、长 URL 等长短不定的输入。
   */
  autoResize?: boolean;
}

/**
 * 多行文本框，shadcn 风格
 * @param props 原生 textarea 属性，额外支持 autoResize 自增高模式
 */
export function Textarea({ className, autoResize, ...props }: TextareaProps) {
  return (
    <textarea
      // 自增高模式默认单行起步，禁用手动拖拽，交由 field-sizing 按内容撑高
      rows={autoResize ? 1 : undefined}
      className={cn(
        'flex w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
        autoResize
          ? 'field-sizing-content min-h-9 resize-none py-1.5'
          : 'min-h-16 py-2',
        className,
      )}
      {...props}
    />
  );
}
