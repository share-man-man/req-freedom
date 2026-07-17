/**
 * 向 URL 注入查询参数（同名参数覆盖）
 * @param url 原始 URL
 * @param params 要注入的键值对
 * @returns 注入后的新 URL；原始 URL 非法时原样返回
 */
export function injectParams(url: string, params: Record<string, string>): string {
  try {
    /** 解析后的 URL 对象 */
    const parsed = new URL(url);
    // 逐个写入参数，set 语义保证同名参数被覆盖而不是重复追加
    for (const [key, value] of Object.entries(params)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
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
