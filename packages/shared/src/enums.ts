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
  /** 注入自定义 JS / CSS */
  InsertScript = 'insert-script',
}

/**
 * 注入代码的类型（决定以 <script> 还是 <style> 注入）
 */
export enum InsertScriptCodeType {
  /** JavaScript 代码，注入后在页面上下文执行 */
  JavaScript = 'js',
  /** CSS 样式，注入后作用于页面 */
  Css = 'css',
}

/**
 * 注入时机（对齐内容脚本 run_at 语义）
 */
export enum InsertScriptTiming {
  /** 文档开始解析时注入，早于页面自身脚本 */
  DocumentStart = 'document_start',
  /** DOM 构建完成（DOMContentLoaded）后注入 */
  DocumentEnd = 'document_end',
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
