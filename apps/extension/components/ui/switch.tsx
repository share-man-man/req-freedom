import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '@/utils/cn';

interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  /** 开关的视觉层级；group 控制整组规则，rule 控制单条规则。 */
  variant?: 'group' | 'rule';
}

/**
 * 开关组件，基于 Radix Switch，shadcn 风格
 * @param props Radix Switch 的原生属性与视觉层级
 */
export function Switch({ className, variant, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        variant === 'group' && 'h-6 w-11 data-[state=checked]:bg-[var(--group-toggle-active)]',
        variant === 'rule' && 'data-[state=checked]:bg-[var(--rule-toggle-active)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
          variant === 'group' && 'size-5 data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
