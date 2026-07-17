import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 className：clsx 处理条件类，tailwind-merge 消解 Tailwind 冲突类
 * @param inputs 任意数量的 className 片段
 * @returns 合并去重后的 className 字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
