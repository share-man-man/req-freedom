import {
  HeaderOperation,
  HeaderTarget,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
  RuleTemplateCategory,
} from './enums';
import type { Rule } from './types';

/**
 * 规则模板承载的规则草稿
 *
 * 模板是「除运行时 id 外都填好的规则」：ID 只在真正落库时由使用方补上（`crypto.randomUUID()`），
 * 模板本身保持无副作用的纯数据，可安全跨上下文复用。
 */
type RuleTemplateDraft = Omit<Rule, 'id'>;

/**
 * 一条开箱即用的常用规则模板
 *
 * 模板本质是对既有动作（多为 Header 改写 / 重定向）的语法糖封装，把「本地联调第一高频需求」
 * 沉淀成一键预设。使用时把 `rule` 补上运行时 id 后放进任意分组，再按需微调匹配范围即可。
 */
export interface RuleTemplate {
  /** 模板稳定标识，用于 UI key 与去重（与规则运行时 id 无关） */
  id: string;
  /** 模板归类，仅用于模板库分区展示 */
  category: RuleTemplateCategory;
  /** 模板展示名 */
  name: string;
  /** 用途与典型场景的一句话说明 */
  description: string;
  /** 生成的规则草稿（不含运行时 id） */
  rule: RuleTemplateDraft;
}

/**
 * 内置常用规则模板清单（模板库据此分区展示，一键生成规则草稿）
 *
 * 说明：
 * - 需要「按响应改写 / 网络层生效」的模板走 DNR 通道；这些模板对全部请求生效（含页面导航、静态资源）。
 * - 涉及具体接口 / 站点的模板（CORS、禁用缓存、UA 切换）默认填示例域名占位，提示用户改成自己的目标地址，
 *   避免一键就对全站生效造成误伤；「强制 HTTPS」按协议前缀命中，天然适合全量匹配。
 */
export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'cors-allow-all',
    category: RuleTemplateCategory.Cors,
    name: '解除 CORS 跨域限制',
    description: '为匹配的响应补上 Access-Control-Allow-* 头，解决本地联调时的跨域拦截。请把匹配内容改成你的接口地址。',
    rule: {
      name: '解除 CORS 跨域限制',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [],
      matchType: MatchType.Wildcard,
      pattern: 'https://api.example.com/*',
      actions: [
        {
          type: RuleActionType.ModifyHeaders,
          headers: [
            // DNR 拿不到请求的 Origin，无法回显，故用通配 `*`；与 `*` 搭配的凭据模式（Allow-Credentials）
            // 会被浏览器拒绝，这里不设置，覆盖最常见的无凭据跨域场景。
            { target: HeaderTarget.Response, operation: HeaderOperation.Set, header: 'Access-Control-Allow-Origin', value: '*' },
            { target: HeaderTarget.Response, operation: HeaderOperation.Set, header: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD' },
            { target: HeaderTarget.Response, operation: HeaderOperation.Set, header: 'Access-Control-Allow-Headers', value: '*' },
          ],
        },
      ],
    },
  },
  {
    id: 'disable-cache',
    category: RuleTemplateCategory.Cache,
    name: '禁用缓存',
    description: '为请求与响应都补上不缓存的 Cache-Control，确保每次都拿到最新资源。请把匹配内容改成目标地址。',
    rule: {
      name: '禁用缓存',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [],
      matchType: MatchType.Wildcard,
      pattern: 'https://api.example.com/*',
      actions: [
        {
          type: RuleActionType.ModifyHeaders,
          headers: [
            { target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'Pragma', value: 'no-cache' },
            { target: HeaderTarget.Response, operation: HeaderOperation.Set, header: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          ],
        },
      ],
    },
  },
  {
    id: 'force-https',
    category: RuleTemplateCategory.Protocol,
    name: '强制 HTTPS',
    description: '把匹配到的 http 请求重定向到同地址的 https。默认命中全部 http 请求。',
    rule: {
      name: '强制 HTTPS',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [],
      // 用正则捕获协议后的整段地址，重定向时以 \1 原样拼回 https，实现纯协议升级
      matchType: MatchType.Regex,
      pattern: '^http://(.*)$',
      actions: [{ type: RuleActionType.Redirect, redirectUrl: 'https://\\1' }],
    },
  },
  {
    id: 'mobile-ua-ios',
    category: RuleTemplateCategory.UserAgent,
    name: '移动端 UA · iPhone',
    description: '把 User-Agent 改成 iOS Safari，让站点返回移动端页面。请把匹配内容改成目标站点。',
    rule: {
      name: '移动端 UA · iPhone',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [],
      matchType: MatchType.Wildcard,
      pattern: 'https://www.example.com/*',
      actions: [
        {
          type: RuleActionType.ModifyHeaders,
          headers: [
            { target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'User-Agent', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
          ],
        },
      ],
    },
  },
  {
    id: 'mobile-ua-android',
    category: RuleTemplateCategory.UserAgent,
    name: '移动端 UA · Android',
    description: '把 User-Agent 改成 Android Chrome，让站点返回移动端页面。请把匹配内容改成目标站点。',
    rule: {
      name: '移动端 UA · Android',
      enabled: true,
      channel: RuleExecutionChannel.Dnr,
      methods: [],
      matchType: MatchType.Wildcard,
      pattern: 'https://www.example.com/*',
      actions: [
        {
          type: RuleActionType.ModifyHeaders,
          headers: [
            { target: HeaderTarget.Request, operation: HeaderOperation.Set, header: 'User-Agent', value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' },
          ],
        },
      ],
    },
  },
];
