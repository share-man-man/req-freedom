import { RequestBodyMode } from '@req-freedom/shared';

/**
 * 判断值是否为可深合并的普通对象（排除数组与 null）
 * @param value 待判断的值
 * @returns 是普通对象时返回 true
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深合并两个 JSON 值：对象递归合并，数组与基本类型由补丁整体覆盖。
 * @param base 原始值
 * @param patch 补丁值
 * @returns 合并后的新值
 */
function deepMergeJson(base: unknown, patch: unknown): unknown {
  // 任一侧不是普通对象时无从逐键合并，直接以补丁覆盖
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  /** 合并结果：先浅拷贝原对象，再逐键写入补丁。 */
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in merged ? deepMergeJson(merged[key], value) : value;
  }
  return merged;
}

/**
 * 按改写模式生成新的请求体文本。
 * @param mode 改写模式
 * @param content 规则配置的改写内容（Replace 为新请求体；MergeJson 为 JSON 补丁）
 * @param originalBody 原始请求体文本（Replace 模式忽略）
 * @returns 改写后的请求体文本；MergeJson 模式在 JSON 解析失败时回退为原始请求体
 */
export function modifyRequestBody(
  mode: RequestBodyMode,
  content: string,
  originalBody: string,
): string {
  if (mode === RequestBodyMode.Replace) {
    return content;
  }
  try {
    /** 解析后的原始请求体，空体按空对象处理以便合并。 */
    const base = originalBody.trim() ? JSON.parse(originalBody) : {};
    /** 解析后的 JSON 补丁。 */
    const patch = JSON.parse(content) as unknown;
    return JSON.stringify(deepMergeJson(base, patch));
  } catch {
    // 原始体或补丁不是合法 JSON 时不做改写，保持请求原样发出
    return originalBody;
  }
}

/**
 * 延迟指定毫秒数
 * @param ms 延迟时长（毫秒），小于等于 0 时立即返回
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
