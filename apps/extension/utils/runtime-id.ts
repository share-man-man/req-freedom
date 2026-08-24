/** 当前执行上下文中不支持 randomUUID 时使用的递增序号。 */
let fallbackRuntimeIdSequence = 0;

/**
 * 生成当前执行上下文内唯一的运行时 ID。
 * @returns 优先使用浏览器 UUID，否则使用时间戳、序号与随机片段
 */
export function createRuntimeId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackRuntimeIdSequence += 1;
  /** 后备 ID 的随机片段。 */
  const entropy = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${fallbackRuntimeIdSequence.toString(36)}-${entropy}`;
}
