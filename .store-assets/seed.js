/**
 * ReqFreedom 商店素材的种子数据。
 *
 * store-assets skill 的 chrome-shim.js 会读取这里挂出的对象，把它当成扩展的"存档"。
 * 素材里出现的每一条规则、每一行命中日志都来自这里，所以这份文件同时也是
 * 素材的内容脚本：想让截图展示哪些功能，就在这里造哪些数据。
 *
 * 两条硬性要求：
 * 1. 结构必须与 packages/shared 的 RuleGroup / Rule 类型一致。字段对不上时
 *    界面会静默少渲染一块而不是报错，出图后务必逐张核对。
 * 2. 只用 example.com 一类的占位内容——素材要公开发布。
 */
(function () {
  'use strict';

  /* storage 键名，与 packages/shared/src/constants.ts 保持一致 */
  /** 规则分组列表的 storage 键。 */
  const STORAGE_KEY_GROUPS = 'req-freedom:groups';
  /** 全局开关的 storage 键。 */
  const STORAGE_KEY_ENABLED = 'req-freedom:enabled';
  /** 界面语言的 storage 键。 */
  const STORAGE_KEY_LOCALE = 'req-freedom:locale';
  /** 界面主题的 storage 键。 */
  const STORAGE_KEY_THEME = 'req-freedom:theme';

  /* runtime 消息类型，与 packages/shared/src/constants.ts 保持一致 */
  /** 查询仍有命中日志的标签页列表。 */
  const MSG_LIST_HIT_TABS = 'req-freedom:list-rule-hit-tabs';
  /** 查询某标签页的完整命中日志。 */
  const MSG_GET_HIT_LOG = 'req-freedom:get-rule-hit-log';
  /** 查询当前标签页的命中摘要。 */
  const MSG_GET_HIT_SUMMARY = 'req-freedom:get-rule-hit-summary';

  /** 页面 URL 上的查询参数，用于切换素材的语言与主题。 */
  const params = new URLSearchParams(location.search);

  /** 演示用规则分组，覆盖全部 8 种动作类型与两条执行通道。 */
  const groups = [
    {
      id: 'grp-local-dev',
      name: 'Local Development',
      enabled: true,
      updatedAt: '2026-08-12T09:24:00.000Z',
      rules: [
        {
          id: 'rule-redirect-api',
          name: 'Point checkout API to localhost',
          enabled: true,
          channel: 'dnr',
          matchType: 'regex',
          pattern: '^https://api\\.example\\.com/v2/(.*)$',
          methods: [],
          actions: [{ type: 'redirect', redirectUrl: 'http://localhost:3000/v2/\\1' }],
        },
        {
          id: 'rule-cors',
          name: 'Allow CORS on staging API',
          enabled: true,
          channel: 'dnr',
          matchType: 'wildcard',
          pattern: 'https://staging.example.com/api/*',
          methods: [],
          actions: [
            {
              type: 'modify-headers',
              headers: [
                { target: 'response', operation: 'set', header: 'Access-Control-Allow-Origin', value: '*' },
                { target: 'response', operation: 'set', header: 'Access-Control-Allow-Credentials', value: 'true' },
                { target: 'request', operation: 'set', header: 'Authorization', value: 'Bearer {{randomString(24)}}' },
              ],
            },
          ],
        },
        {
          id: 'rule-inject-params',
          name: 'Force debug flags on every call',
          enabled: true,
          channel: 'dnr',
          matchType: 'contains',
          pattern: 'api.example.com',
          methods: ['GET'],
          actions: [{ type: 'inject-params', params: { debug: '1', trace_id: '{{uuid}}' } }],
        },
        {
          id: 'rule-block-analytics',
          name: 'Block analytics beacons',
          enabled: false,
          channel: 'dnr',
          matchType: 'wildcard',
          pattern: '*://*.analytics-cdn.com/*',
          methods: [],
          actions: [{ type: 'block' }],
        },
      ],
    },
    {
      id: 'grp-mock',
      name: 'Mock & Fault Injection',
      enabled: true,
      updatedAt: '2026-08-13T14:05:00.000Z',
      rules: [
        {
          id: 'rule-mock-orders',
          name: 'Mock empty order list',
          enabled: true,
          channel: 'page-patch',
          matchType: 'contains',
          pattern: '/api/v2/orders',
          methods: ['GET'],
          actions: [
            {
              type: 'mock-response',
              mode: 'static',
              delivery: 'buffered',
              statusCode: 200,
              bodyType: 'json',
              responseHeaders: { 'X-Mocked-By': 'ReqFreedom' },
              body: JSON.stringify(
                { code: 0, message: 'ok', data: { total: 0, page: 1, list: [] } },
                null,
                2,
              ),
              delayMs: 0,
            },
          ],
        },
        {
          id: 'rule-mock-profile',
          name: 'Patch user role to admin',
          enabled: true,
          channel: 'page-patch',
          matchType: 'contains',
          pattern: '/api/v2/me',
          methods: ['GET'],
          actions: [
            {
              type: 'mock-response',
              mode: 'dynamic',
              delivery: 'buffered',
              statusCode: 200,
              passthrough: true,
              body: '',
              functionCode:
                'function mock(req, res) {\n  return {\n    ...res.json,\n    role: "admin",\n    features: [...(res.json.features ?? []), "beta-dashboard"],\n  };\n}',
            },
          ],
        },
        {
          id: 'rule-mock-500',
          name: 'Return 500 on payment submit',
          enabled: false,
          channel: 'page-patch',
          matchType: 'contains',
          pattern: '/api/v2/payments',
          methods: ['POST'],
          actions: [
            {
              type: 'mock-response',
              mode: 'static',
              delivery: 'buffered',
              statusCode: 500,
              statusText: 'Internal Server Error',
              bodyType: 'json',
              body: JSON.stringify({ code: 50001, message: 'Payment gateway timeout' }, null, 2),
            },
          ],
        },
        {
          id: 'rule-delay',
          name: 'Throttle checkout to Slow 3G',
          enabled: true,
          channel: 'page-patch',
          matchType: 'contains',
          pattern: '/api/v2/checkout',
          methods: [],
          actions: [
            {
              type: 'delay',
              throttlePreset: 'slow-3g',
              latencyMs: 400,
              downloadKbps: 400,
              uploadKbps: 400,
            },
          ],
        },
      ],
    },
    {
      id: 'grp-page',
      name: 'Page Tweaks',
      enabled: true,
      updatedAt: '2026-08-14T02:41:00.000Z',
      rules: [
        {
          id: 'rule-graphql-body',
          name: 'Raise GraphQL page size to 100',
          enabled: true,
          channel: 'page-patch',
          matchType: 'contains',
          pattern: '/graphql',
          methods: ['POST'],
          bodyMatch: { type: 'graphql-operation', value: 'ProductList' },
          actions: [
            {
              type: 'modify-request-body',
              sourceMode: 'static',
              mode: 'merge-json',
              content: JSON.stringify({ variables: { first: 100 } }, null, 2),
            },
          ],
        },
        {
          id: 'rule-insert-script',
          name: 'Highlight mocked responses',
          enabled: true,
          channel: 'page-patch',
          matchType: 'wildcard',
          pattern: 'https://shop.example.com/*',
          methods: [],
          actions: [
            {
              type: 'insert-script',
              codeType: 'css',
              timing: 'document_end',
              code: '[data-mocked="true"] {\n  outline: 2px dashed #f59e0b;\n  outline-offset: 2px;\n}',
            },
          ],
        },
      ],
    },
  ];

  /** 演示用标签页，供作用域选择器与请求日志的标签页下拉展示。 */
  const tabs = [
    { id: 101, windowId: 1, groupId: 11, index: 0, active: true, title: 'Example Shop — Checkout', url: 'https://shop.example.com/checkout', favIconUrl: '' },
    { id: 102, windowId: 1, groupId: 11, index: 1, active: false, title: 'Example Admin — Orders', url: 'https://admin.example.com/orders', favIconUrl: '' },
    { id: 103, windowId: 1, groupId: -1, index: 2, active: false, title: 'ReqFreedom Docs', url: 'https://share-man-man.github.io/req-freedom/', favIconUrl: '' },
  ];

  /** 相对当前时间生成命中记录，让日志看起来是刚刚发生的。 */
  const now = Date.now();

  /**
   * 演示用命中日志，按标签页 ID 索引。
   *
   * 特意混入 outcome 为 skipped 的记录：「匹配上但未应用」是这个扩展相对
   * 同类工具的细节，素材里体现出来比全是 applied 更有说服力。
   */
  const hitLogs = {
    101: {
      truncated: false,
      hits: [
        { ruleId: 'rule-inject-params', action: 'inject-params', url: 'https://api.example.com/v2/cart?debug=1', method: 'GET', at: now - 42000, outcome: 'applied' },
        { ruleId: 'rule-cors', action: 'modify-headers', url: 'https://staging.example.com/api/config', method: 'GET', at: now - 38000, outcome: 'applied' },
        { ruleId: 'rule-mock-orders', action: 'mock-response', url: 'https://api.example.com/v2/orders?page=1', method: 'GET', at: now - 31000, outcome: 'applied' },
        { ruleId: 'rule-redirect-api', action: 'redirect', url: 'https://api.example.com/v2/shipping/quote', method: 'POST', at: now - 27000, outcome: 'applied' },
        { ruleId: 'rule-delay', action: 'delay', url: 'https://api.example.com/v2/checkout/preview', method: 'POST', at: now - 19000, outcome: 'applied' },
        { ruleId: 'rule-graphql-body', action: 'modify-request-body', url: 'https://shop.example.com/graphql', method: 'POST', at: now - 14000, outcome: 'applied' },
        { ruleId: 'rule-mock-profile', action: 'mock-response', url: 'https://api.example.com/v2/me', method: 'GET', at: now - 9000, outcome: 'applied' },
        { ruleId: 'rule-mock-orders', action: 'mock-response', url: 'https://api.example.com/v2/orders?page=2', method: 'GET', at: now - 6000, outcome: 'skipped', reason: 'opaque-response' },
        { ruleId: 'rule-insert-script', action: 'insert-script', url: 'https://shop.example.com/checkout', method: 'GET', at: now - 3000, outcome: 'applied' },
      ],
    },
    102: {
      truncated: false,
      hits: [
        { ruleId: 'rule-cors', action: 'modify-headers', url: 'https://staging.example.com/api/orders', method: 'GET', at: now - 120000, outcome: 'applied' },
        { ruleId: 'rule-mock-orders', action: 'mock-response', url: 'https://api.example.com/v2/orders', method: 'GET', at: now - 95000, outcome: 'skipped', reason: 'sync-xhr' },
      ],
    },
  };

  window.__STORE_ASSETS_SEED__ = {
    storage: {
      local: {
        [STORAGE_KEY_GROUPS]: groups,
        [STORAGE_KEY_ENABLED]: true,
        // 「全球通用」素材统一用英文；?locale=zh-CN 出中文分区的图
        [STORAGE_KEY_LOCALE]: params.get('locale') || 'en',
        [STORAGE_KEY_THEME]: params.get('theme') || 'light',
      },
      session: {},
    },

    uiLanguage: 'en-US',

    tabs,

    windows: [{ id: 1, focused: true, type: 'normal' }],

    tabGroups: [{ id: 11, windowId: 1, title: 'Example Project', color: 'blue', collapsed: false }],

    /**
     * 应答页面发往 background 的命中日志查询。
     * @param message 页面发出的运行时消息
     * @returns 该消息的应答；未识别时返回 undefined
     */
    onMessage(message) {
      switch (message?.type) {
        case MSG_LIST_HIT_TABS:
          return Object.entries(hitLogs).map(([tabId, log]) => ({
            tabId: Number(tabId),
            total: log.hits.length,
            lastHitAt: log.hits[log.hits.length - 1].at,
          }));
        case MSG_GET_HIT_LOG:
          return hitLogs[message.tabId] ?? { hits: [], truncated: false };
        case MSG_GET_HIT_SUMMARY: {
          /** 当前演示标签页的命中日志。 */
          const log = hitLogs[tabs[0].id];
          return {
            ruleIds: [
              ...new Set(log.hits.filter((hit) => hit.outcome === 'applied').map((hit) => hit.ruleId)),
            ],
            skippedRuleIds: {},
            truncated: false,
          };
        }
        default:
          return undefined;
      }
    },
  };
})();
