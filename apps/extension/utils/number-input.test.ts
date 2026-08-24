import { describe, expect, it } from 'vitest';
import { parseOptionalNonNegativeNumber } from './number-input';

describe('parseOptionalNonNegativeNumber', () => {
  it('解析非负数，并把空值、负数与非法值收敛为 undefined', () => {
    expect(parseOptionalNonNegativeNumber('0')).toBe(0);
    expect(parseOptionalNonNegativeNumber('12.5')).toBe(12.5);
    expect(parseOptionalNonNegativeNumber('  ')).toBeUndefined();
    expect(parseOptionalNonNegativeNumber('-1')).toBeUndefined();
    expect(parseOptionalNonNegativeNumber('invalid')).toBeUndefined();
  });
});
