import { DynamicVariableName } from '@req-freedom/shared';

/**
 * 动态变量占位符的匹配正则
 *
 * 形如 `{{name}}` 或 `{{name(arg1, arg2)}}`，两侧及括号内允许空白。变量名以字母开头、由字母数字组成，
 * 因此不会误伤 JSON 里的 `{{"a":1}}` 或 Vue / Handlebars 的 `{{ expr }}`（表达式含非字母数字时不匹配）。
 * 参数串按逗号分隔，具体解释交给各变量的解析器。
 */
const DYNAMIC_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:\(([^)]*)\))?\s*\}\}/g;

/** 随机字符串使用的字符集（大小写字母 + 数字）。 */
const RANDOM_STRING_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 随机字符串允许的最大长度，避免用户误填超大值拖垮页面。 */
const RANDOM_STRING_MAX_LENGTH = 1024;

/**
 * 把占位符括号内的原始参数串解析为去空白的参数数组。
 * @param rawArgs 括号内的原始文本（无括号时为 undefined）
 * @returns 逗号分隔的参数列表；无参数时为空数组
 */
function parseArgs(rawArgs: string | undefined): string[] {
  if (rawArgs === undefined || rawArgs.trim() === '') {
    return [];
  }
  return rawArgs.split(',').map((arg) => arg.trim());
}

/**
 * 把参数解析为有限数字，非法时回退默认值。
 * @param value 参数文本（可能为 undefined）
 * @param fallback 解析失败时的默认值
 * @returns 解析出的数字或默认值
 */
function toFiniteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  /** 解析后的数字。 */
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 生成指定长度的随机字母数字串。
 * @param length 目标长度
 * @returns 随机字符串
 */
function randomString(length: number): string {
  /** 逐字符累积的结果。 */
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += RANDOM_STRING_ALPHABET.charAt(Math.floor(Math.random() * RANDOM_STRING_ALPHABET.length));
  }
  return result;
}

/**
 * 各内置动态变量的求值函数：入参为解析后的参数列表，返回替换文本。
 *
 * 用 Record<DynamicVariableName, ...> 保证每个枚举成员都有对应实现，新增变量时类型层强制补齐。
 */
const VARIABLE_RESOLVERS: Record<DynamicVariableName, (args: string[]) => string> = {
  [DynamicVariableName.Uuid]: () => crypto.randomUUID(),
  [DynamicVariableName.Timestamp]: () => String(Math.floor(Date.now() / 1000)),
  [DynamicVariableName.TimestampMs]: () => String(Date.now()),
  [DynamicVariableName.IsoTime]: () => new Date().toISOString(),
  [DynamicVariableName.RandomFloat]: () => String(Math.random()),
  [DynamicVariableName.RandomInt]: (args) => {
    // 单参数视为 max（min 取 0）；两参数为 [min, max]；缺省 0-100
    /** 区间下界。 */
    let min = 0;
    /** 区间上界。 */
    let max = 100;
    if (args.length === 1) {
      max = toFiniteNumber(args[0], 100);
    } else if (args.length >= 2) {
      min = toFiniteNumber(args[0], 0);
      max = toFiniteNumber(args[1], 100);
    }
    // 取整并保证 min <= max，避免用户填反区间导致 NaN
    min = Math.floor(min);
    max = Math.floor(max);
    if (max < min) {
      [min, max] = [max, min];
    }
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  },
  [DynamicVariableName.RandomString]: (args) => {
    /** 目标长度：默认 8，向下取整并夹到 [1, 上限]。 */
    const length = Math.min(Math.max(1, Math.floor(toFiniteNumber(args[0], 8))), RANDOM_STRING_MAX_LENGTH);
    return randomString(length);
  },
};

/**
 * 判断给定名称是否为已支持的内置动态变量。
 * @param name 占位符里的变量名
 * @returns 是内置变量时返回 true
 */
function isDynamicVariableName(name: string): name is DynamicVariableName {
  return Object.prototype.hasOwnProperty.call(VARIABLE_RESOLVERS, name);
}

/**
 * 把文本中的动态变量占位符替换为实际值。
 *
 * 每次调用都会重新求值——页面补丁通道逐请求调用即得到「真·动态」的值；
 * 未识别的占位符（如其他模板语法或拼写错误）原样保留，不会被清空。
 * @param text 可能含 `{{变量}}` 占位符的文本
 * @returns 替换后的文本；无占位符时原样返回
 */
export function resolveDynamicVariables(text: string): string {
  // 快速路径：不含 `{{` 的文本直接返回，避免无谓的正则扫描
  if (!text || !text.includes('{{')) {
    return text;
  }
  return text.replace(DYNAMIC_VARIABLE_PATTERN, (match, name: string, rawArgs: string | undefined) => {
    if (!isDynamicVariableName(name)) {
      // 非内置变量原样保留，兼容页面自身可能存在的其他模板占位符
      return match;
    }
    return VARIABLE_RESOLVERS[name](parseArgs(rawArgs));
  });
}

/**
 * 对字符串键值映射的每个值做动态变量替换（键保持不变）。
 * @param record 原始键值映射（如 Header / 参数）
 * @returns 值已替换动态变量的新映射
 */
export function resolveDynamicVariablesInRecord(record: Record<string, string>): Record<string, string> {
  /** 替换后的键值映射。 */
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveDynamicVariables(value);
  }
  return resolved;
}
