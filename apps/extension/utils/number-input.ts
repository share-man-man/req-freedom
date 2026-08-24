/**
 * 把数字输入框的字符串值收敛为可选的非负数。
 * @param value 输入框原值
 * @returns 空值或非法值返回 undefined，其余返回非负数
 */
export function parseOptionalNonNegativeNumber(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  /** 输入框解析出的数值。 */
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}
