import {
  HeaderOperation,
  HeaderTarget,
  MatchType,
  RuleActionType,
  RuleExecutionChannel,
} from '@req-freedom/shared';
import type { Rule } from '@req-freedom/shared';

/**
 * 常用规则模板的归类
 *
 * 仅用于模板库 UI 的分区展示，不参与规则的执行语义。UI 展示文案见 `RULE_TEMPLATE_CATEGORY_LABELS`。
 */
export enum RuleTemplateCategory {
  /** 跨域（CORS）相关 */
  Cors = 'cors',
  /** 缓存控制相关 */
  Cache = 'cache',
  /** 协议 / 重定向相关 */
  Protocol = 'protocol',
  /** User-Agent 切换相关 */
  UserAgent = 'user-agent',
}

/**
 * 规则模板承载的规则草稿
 *
 * 模板是「除运行时 id 与名称外都填好的规则」：ID 与 name 只在真正实例化时由
 * `instantiateRuleTemplate` 补上（name 取自当前语言下 `nameKey` 的翻译），
 * 模板本身保持无副作用的纯数据，可安全跨上下文复用。
 */
type RuleTemplateDraft = Omit<Rule, 'id' | 'name'>;

/**
 * 一条开箱即用的常用规则模板
 *
 * 模板本质是对既有动作（多为 Header 改写 / 重定向）的语法糖封装，把「本地联调第一高频需求」
 * 沉淀成一键预设。使用时把 `rule` 补上运行时 id 与翻译后的名称后放进任意分组，再按需微调匹配范围即可。
 */
export interface RuleTemplate {
  /** 模板稳定标识，用于 UI key 与去重（与规则运行时 id 无关） */
  id: string;
  /** 模板归类，仅用于模板库分区展示 */
  category: RuleTemplateCategory;
  /** 模板展示名对应的 i18n key（写入规则前需用当前语言翻译成普通字符串） */
  nameKey: string;
  /** 用途与典型场景说明对应的 i18n key */
  descriptionKey: string;
  /** 生成的规则草稿（不含运行时 id 与 name） */
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
    nameKey: 'template.corsAllowAll.name',
    descriptionKey: 'template.corsAllowAll.description',
    rule: {
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
    nameKey: 'template.disableCache.name',
    descriptionKey: 'template.disableCache.description',
    rule: {
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
    nameKey: 'template.forceHttps.name',
    descriptionKey: 'template.forceHttps.description',
    rule: {
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
    nameKey: 'template.mobileUaIos.name',
    descriptionKey: 'template.mobileUaIos.description',
    rule: {
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
    nameKey: 'template.mobileUaAndroid.name',
    descriptionKey: 'template.mobileUaAndroid.description',
    rule: {
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
