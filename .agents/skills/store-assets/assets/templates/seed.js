/**
 * 商店素材的种子数据（项目自有，不属于 skill）。
 *
 * chrome-shim.js 会读取这里挂出的对象，把它当成扩展的"存档"。素材里出现的
 * 每一条数据都来自这里，所以这份文件同时也是素材的内容脚本：想让截图里
 * 展示哪些功能，就在这里造哪些数据。
 *
 * 两条硬性要求：
 * 1. 数据结构必须与扩展真实使用的类型一致，字段对不上时界面会静默少渲染一块，
 *    而不是报错——出图前务必逐张核对。
 * 2. 只用 example.com 一类的占位内容。素材要公开发布，不能出现真实内网地址、
 *    token、客户名或个人信息。
 */
(function () {
  'use strict';

  /** 页面 URL 上的查询参数，用于切换素材的语言、主题或数据集。 */
  const params = new URLSearchParams(location.search);

  window.__STORE_ASSETS_SEED__ = {
    /** 预置到 chrome.storage 各区的内容，键名与扩展真实使用的保持一致。 */
    storage: {
      local: {
        // 'my-ext:settings': { theme: params.get('theme') || 'light' },
      },
      session: {},
    },

    /** chrome.i18n.getUILanguage() 的返回值。 */
    uiLanguage: params.get('locale') === 'zh-CN' ? 'zh-CN' : 'en-US',

    /** chrome.tabs.query() 返回的标签页。 */
    tabs: [
      {
        id: 101,
        windowId: 1,
        groupId: -1,
        index: 0,
        active: true,
        title: 'Example',
        url: 'https://example.com/',
      },
    ],

    /** chrome.windows.getAll() 返回的窗口。 */
    windows: [{ id: 1, focused: true, type: 'normal' }],

    /** chrome.tabGroups.query() 返回的标签组。 */
    tabGroups: [],

    /**
     * 应答 chrome.runtime.sendMessage()。
     *
     * 扩展页面常向 background 要数据（统计、日志、当前状态），background
     * 在这套环境里并不存在，这里按消息类型直接返回构造好的结果。
     * @param message 页面发出的运行时消息
     * @returns 该消息的应答；未识别时返回 undefined
     */
    onMessage(message) {
      switch (message?.type) {
        // case 'my-ext:get-stats':
        //   return { total: 42 };
        default:
          return undefined;
      }
    },
  };
})();
