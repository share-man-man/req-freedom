/**
 * 把扩展页面搬到普通网页环境里跑起来的 chrome.* 垫片（项目无关）。
 *
 * 为什么需要它：无头浏览器装不了扩展，`chrome-extension://` 页面根本打不开，
 * 而扩展的 options / popup 一挂载就会调 chrome.storage、chrome.runtime，
 * 缺了它们页面要么白屏要么渲染成空状态。这里用静态服务器托管打包产物，
 * 由垫片补齐这些 API，页面就能在普通标签页里正常渲染，供截图使用。
 *
 * 本文件不含任何项目数据。要展示什么内容，由项目自己的 seed.js 提供：
 *
 *   window.__STORE_ASSETS_SEED__ = {
 *     storage:   { local: { ... }, session: { ... } },  // 预置的 storage 内容
 *     tabs:      [ { id, windowId, groupId, title, url, active }, ... ],
 *     windows:   [ { id, focused, type }, ... ],
 *     tabGroups: [ { id, windowId, title, color }, ... ],
 *     uiLanguage: 'en-US',
 *     onMessage(message) { return reply; },   // 应答 runtime.sendMessage
 *     overrides: { ... },                     // 补充/覆盖任意 chrome.* 实现
 *   };
 *
 * 每一项都可缺省，缺省即空。seed.js 自身是普通脚本，可以读 location.search，
 * 按查询参数切换语言、主题或数据集。
 *
 * 垫片只覆盖常见 API。遇到没覆盖的接口，用 `overrides` 在项目侧补，
 * 不必改动本文件——这是让同一份 skill 适配不同扩展的主要手段。
 *
 * 加载顺序要求：seed.js → chrome-shim.js → 页面入口脚本。都用经典 <script>，
 * 保证在入口模块执行前 chrome 已经存在。
 */
(function () {
  'use strict';

  /** 项目提供的种子数据；未提供时一切从空开始。 */
  const seed = window.__STORE_ASSETS_SEED__ ?? {};

  /** storage.local 的内存数据。 */
  const localArea = { ...(seed.storage?.local ?? {}) };
  /** storage.session 的内存数据。 */
  const sessionArea = { ...(seed.storage?.session ?? {}) };
  /** storage.sync 的内存数据。 */
  const syncArea = { ...(seed.storage?.sync ?? {}) };

  /** 已注册的 storage.onChanged 监听器。 */
  const changeListeners = new Set();

  /** 演示用标签页；缺省给一个，否则 tabs.query 返回空数组会让不少界面崩在下标访问上。 */
  const tabs = seed.tabs ?? [
    { id: 1, windowId: 1, groupId: -1, index: 0, active: true, title: 'Example', url: 'https://example.com/' },
  ];
  /** 演示用窗口。 */
  const windows = seed.windows ?? [{ id: 1, focused: true, type: 'normal' }];
  /** 演示用标签组。 */
  const tabGroups = seed.tabGroups ?? [];

  /**
   * 按 chrome.storage.get 的多种入参形态取值。
   * @param area 目标存储区数据
   * @param keys 字符串 / 字符串数组 / 带默认值的对象 / null
   * @returns 查询结果对象
   */
  function readKeys(area, keys) {
    if (keys === null || keys === undefined) return { ...area };
    if (typeof keys === 'string') {
      return keys in area ? { [keys]: area[keys] } : {};
    }
    if (Array.isArray(keys)) {
      /** 逐键收集到的结果。 */
      const picked = {};
      for (const key of keys) {
        if (key in area) picked[key] = area[key];
      }
      return picked;
    }
    /** 带默认值的对象形态，缺失时回落到默认值。 */
    const withDefaults = {};
    for (const [key, fallback] of Object.entries(keys)) {
      withDefaults[key] = key in area ? area[key] : fallback;
    }
    return withDefaults;
  }

  /**
   * 构造一个存储区对象，写入时同步派发 onChanged。
   *
   * 派发是必要的：扩展页面普遍靠 storage.onChanged 跟随外部改动重渲染，
   * 少了它，任何"改一下再看效果"的交互在素材里都不会更新。
   * @param area 底层数据对象
   * @param areaName 存储区名称（local / session / sync）
   * @returns chrome.storage.<area> 形态的对象
   */
  function createArea(area, areaName) {
    return {
      get: (keys) => Promise.resolve(readKeys(area, keys)),
      set: (items) => {
        /** 本次写入产生的变更集合。 */
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: area[key], newValue: value };
          area[key] = value;
        }
        for (const listener of changeListeners) listener(changes, areaName);
        return Promise.resolve();
      },
      remove: (keys) => {
        /** 待删除的键列表。 */
        const keyList = Array.isArray(keys) ? keys : [keys];
        /** 本次删除产生的变更集合。 */
        const changes = {};
        for (const key of keyList) {
          changes[key] = { oldValue: area[key], newValue: undefined };
          delete area[key];
        }
        for (const listener of changeListeners) listener(changes, areaName);
        return Promise.resolve();
      },
      clear: () => {
        for (const key of Object.keys(area)) delete area[key];
        return Promise.resolve();
      },
    };
  }

  /** 供扩展页面使用的伪 chrome 命名空间。 */
  const shim = {
    storage: {
      local: createArea(localArea, 'local'),
      session: createArea(sessionArea, 'session'),
      sync: createArea(syncArea, 'sync'),
      onChanged: {
        addListener: (listener) => changeListeners.add(listener),
        removeListener: (listener) => changeListeners.delete(listener),
        hasListener: (listener) => changeListeners.has(listener),
      },
    },
    runtime: {
      id: 'store-assets-shim',
      lastError: undefined,
      getURL: (path) => new URL(String(path).replace(/^\/?/, '/'), location.origin).href,
      getManifest: () => seed.manifest ?? {},
      sendMessage: (message) => Promise.resolve(seed.onMessage?.(message)),
      onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      connect: () => ({
        postMessage: () => {},
        disconnect: () => {},
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
      }),
    },
    i18n: {
      getUILanguage: () => seed.uiLanguage ?? 'en-US',
      getMessage: (key) => seed.messages?.[key] ?? key,
    },
    tabs: {
      query: () => Promise.resolve(tabs.map((tab) => ({ ...tab }))),
      get: (tabId) => Promise.resolve({ ...(tabs.find((tab) => tab.id === tabId) ?? tabs[0]) }),
      // 素材页面里点"打开文档"之类的链接不应该真的换页，交给新窗口
      create: ({ url }) => {
        if (url) window.open(url, '_blank', 'noopener');
        return Promise.resolve({ id: 999 });
      },
      update: () => Promise.resolve({}),
      sendMessage: (_tabId, message) => Promise.resolve(seed.onMessage?.(message)),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onActivated: { addListener: () => {}, removeListener: () => {} },
    },
    windows: {
      getAll: () =>
        Promise.resolve(windows.map((win) => ({ ...win, tabs: tabs.map((tab) => ({ ...tab })) }))),
      getCurrent: () => Promise.resolve({ ...windows[0] }),
      update: () => Promise.resolve({}),
      WINDOW_ID_NONE: -1,
    },
    tabGroups: {
      query: () => Promise.resolve(tabGroups.map((group) => ({ ...group }))),
      TAB_GROUP_ID_NONE: -1,
    },
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve(),
      setTitle: () => Promise.resolve(),
      setIcon: () => Promise.resolve(),
    },
    // 这些枚举常在模块顶层就被读取，缺了会在脚本加载阶段直接抛错，页面白屏
    declarativeNetRequest: {
      HeaderOperation: { APPEND: 'append', REMOVE: 'remove', SET: 'set' },
      RuleActionType: {
        BLOCK: 'block',
        REDIRECT: 'redirect',
        MODIFY_HEADERS: 'modifyHeaders',
        ALLOW: 'allow',
        UPGRADE_SCHEME: 'upgradeScheme',
        ALLOW_ALL_REQUESTS: 'allowAllRequests',
      },
      ResourceType: {},
      DomainType: {},
      getDynamicRules: () => Promise.resolve([]),
      updateDynamicRules: () => Promise.resolve(),
      getSessionRules: () => Promise.resolve([]),
      updateSessionRules: () => Promise.resolve(),
      getEnabledRulesets: () => Promise.resolve([]),
    },
    webRequest: {
      onBeforeRequest: { addListener: () => {}, removeListener: () => {} },
      onBeforeSendHeaders: { addListener: () => {}, removeListener: () => {} },
      onCompleted: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: () => Promise.resolve([]),
      insertCSS: () => Promise.resolve(),
    },
    permissions: {
      contains: () => Promise.resolve(true),
      request: () => Promise.resolve(true),
    },
    // MV3 里 chrome.extension 大多已废弃，但这两个查询仍在用，且常被页面
    // 用来决定渲染哪种提示——返回值交给种子控制，好出「已授权 / 未授权」两套图
    extension: {
      isAllowedFileSchemeAccess: () => Promise.resolve(seed.fileSchemeAccess ?? true),
      isAllowedIncognitoAccess: () => Promise.resolve(seed.incognitoAccess ?? false),
      getURL: (path) => new URL(String(path).replace(/^\/?/, '/'), location.origin).href,
    },
    alarms: {
      create: () => {},
      clear: () => Promise.resolve(true),
      getAll: () => Promise.resolve([]),
      onAlarm: { addListener: () => {}, removeListener: () => {} },
    },
  };

  /**
   * 把种子里的自定义实现覆盖进垫片。
   *
   * 逐个补齐所有扩展 API 是做不完的。项目遇到垫片没覆盖、或需要特定返回值的
   * 接口时，在 seed.js 里给 `overrides` 就行，不必改动 skill 本身：
   *
   *   overrides: { downloads: { download: () => Promise.resolve(1) } }
   *
   * 只合并一层命名空间：同名命名空间内按方法覆盖，其余保留垫片默认实现。
   * @param base 垫片对象
   * @param overrides 种子提供的覆盖
   */
  function applyOverrides(base, overrides) {
    for (const [namespace, members] of Object.entries(overrides ?? {})) {
      base[namespace] =
        typeof members === 'object' && members !== null && !Array.isArray(members)
          ? { ...(base[namespace] ?? {}), ...members }
          : members;
    }
  }

  applyOverrides(shim, seed.overrides);

  globalThis.chrome = shim;
  globalThis.browser = shim;
})();
