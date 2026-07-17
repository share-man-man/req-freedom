/**
 * 规则类型：插件支持的全部拦截能力
 */
export enum RuleType {
  /** 拦截（阻断请求） */
  Block = 'block',
  /** 重定向到新地址 */
  Redirect = 'redirect',
  /** URL 查询参数注入 */
  InjectParams = 'inject-params',
  /** 请求/响应 Header 改写 */
  ModifyHeaders = 'modify-headers',
  /** 返回值 Mock */
  MockResponse = 'mock-response',
  /** 延迟模拟 */
  Delay = 'delay',
}

/**
 * URL 匹配方式
 */
export enum MatchType {
  /** 包含子串 */
  Contains = 'contains',
  /** 完全相等 */
  Equals = 'equals',
  /** 通配符（* 匹配任意字符） */
  Wildcard = 'wildcard',
  /** 正则表达式 */
  Regex = 'regex',
}

/**
 * Header 改写的作用目标
 */
export enum HeaderTarget {
  /** 请求头 */
  Request = 'request',
  /** 响应头 */
  Response = 'response',
}

/**
 * Header 改写操作
 */
export enum HeaderOperation {
  /** 设置（覆盖） */
  Set = 'set',
  /** 追加 */
  Append = 'append',
  /** 移除 */
  Remove = 'remove',
}
