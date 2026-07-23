import { useEffect, useRef, useState } from 'react';
import { Braces, Check, Copy } from 'lucide-react';
import { DYNAMIC_VARIABLES } from '@req-freedom/shared';
import { cn } from '@/utils/cn';

/** DynamicVariableHint 组件属性。 */
interface DynamicVariableHintProps {
  /** 附加到触发按钮的样式类。 */
  className?: string;
}

/**
 * 动态变量提示：一个「{{ }} 变量」小按钮，点开后浮出内置变量清单，点击某项即复制其占位符到剪贴板。
 *
 * 气泡就地 absolute 定位，故使用处需保证外层 DOM 不裁剪溢出（CodeEditor 已把 `overflow-hidden`
 * 收窄到内容区，头部不裁剪）。列表数据来自 shared 的 DYNAMIC_VARIABLES 单一数据源；编辑器没有统一
 * 插入光标，故用「复制占位符」这一通用交互，复制后自行粘贴到取值字段。
 * @param props 触发按钮样式类
 */
export function DynamicVariableHint({ className }: DynamicVariableHintProps) {
  /** 气泡是否展开。 */
  const [open, setOpen] = useState(false);
  /** 最近一次复制成功的变量名（用于短暂展示「已复制」）。 */
  const [copiedName, setCopiedName] = useState<string | null>(null);
  /** 组件根节点，用于点击外部时收起气泡。 */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 「已复制」提示的清除定时器。 */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 气泡展开时，点击外部或按 Esc 收起
  useEffect(() => {
    if (!open) {
      return;
    }
    /** 点击组件外部则收起气泡。 */
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    /**
     * 按 Esc 收起气泡。
     *
     * 捕获阶段处理并 stopPropagation：本组件常嵌在 Radix Dialog 内，而 Dialog 的 Esc 关闭监听在冒泡阶段；
     * 不拦住的话按 Esc 会连同整个规则对话框一起关掉。气泡打开时 Esc 只应关气泡。
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // 卸载时清理「已复制」定时器
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  /**
   * 复制某个变量的占位符到剪贴板并短暂高亮。
   * @param name 变量名（用于标记高亮）
   * @param placeholder 要复制的占位符文本
   */
  const handleCopy = (name: string, placeholder: string): void => {
    void navigator.clipboard?.writeText(placeholder).then(() => {
      setCopiedName(name);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedName(null), 1200);
    });
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
          className,
        )}
        aria-expanded={open}
        title="查看可用的动态变量"
      >
        <Braces className="size-3" />
        变量
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md">
          <p className="px-1.5 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">
            在取值字段里用占位符引用；点击复制。页面补丁通道逐请求求值，网络层（DNR）在规则同步时求值一次。
          </p>
          <div className="flex flex-col">
            {DYNAMIC_VARIABLES.map((variable) => {
              /** 该项是否刚被复制。 */
              const copied = copiedName === variable.name;
              return (
                <button
                  key={variable.name}
                  type="button"
                  onClick={() => handleCopy(variable.name, variable.placeholder)}
                  className="group flex items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60"
                >
                  <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{variable.placeholder}</code>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-foreground">{variable.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={variable.description}>{variable.description}</span>
                  </span>
                  {copied
                    ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    : <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
