/** 当前页面暴露给注入脚本读取和修改的实验室状态。 */
window.__REQ_FREEDOM_LAB__ = window.__REQ_FREEDOM_LAB__ ?? '页面默认值';

/** 请求日志的最大保留条数，避免长时间测试导致页面无限增长。 */
const MAX_LOG_ITEMS = 30;
/** 用于上行带宽测试的 JSON 请求体大小（字符数近似字节数）。 */
const UPLOAD_PAYLOAD_SIZE = 16 * 1024;

/** 请求日志所在的 DOM 容器。 */
const logList = document.querySelector('#log-list');
/** 日志数量的 DOM 容器。 */
const logCount = document.querySelector('#log-count');
/** 页面地址展示元素。 */
const locationElement = document.querySelector('#location');
/** 插件脚本注入状态展示元素。 */
const injectionValue = document.querySelector('#injection-value');
/** 动态图片资源预览区域。 */
const assetPreview = document.querySelector('#asset-preview');

/**
 * 获取当前页面所在目录对应的 API 资源 URL。
 * @param {string} path API 资源的相对路径。
 * @returns {string} 可用于 fetch 或 XHR 的绝对 URL。
 */
function getApiUrl(path) {
  return new URL(path, window.location.href).toString();
}

/**
 * 将响应文本裁剪为便于阅读的日志摘要。
 * @param {string} body 原始响应文本。
 * @returns {string} 经过长度限制的响应文本。
 */
function summarizeBody(body) {
  /** 响应日志中显示的最大字符数。 */
  const maxLength = 420;
  return body.length > maxLength ? `${body.slice(0, maxLength)}…` : body;
}

/**
 * 向页面追加一条请求结果日志。
 * @param {{name: string, url: string, status?: number, duration: number, body: string, error?: boolean}} entry 请求结果。
 * @returns {void}
 */
function appendLog(entry) {
  /** 新增的单条日志元素。 */
  const item = document.createElement('li');
  /** 日志中的状态文本。 */
  const statusText = entry.error ? '失败' : `HTTP ${entry.status ?? '—'}`;
  item.className = `log-item ${entry.error ? 'error' : 'success'}`;
  item.innerHTML = `<div class="log-meta"><strong>${entry.name}</strong><span>${statusText}</span><span>${entry.duration.toFixed(0)} ms</span></div><div class="log-url">${entry.url}</div><div class="log-body">${summarizeBody(entry.body)}</div>`;
  logList.prepend(item);
  while (logList.children.length > MAX_LOG_ITEMS) {
    logList.lastElementChild.remove();
  }
  logCount.textContent = `${logList.children.length} 条记录`;
}

/**
 * 通过 fetch 发起请求并记录可观察到的结果。
 * @param {string} name 测试项目名称。
 * @param {string} path 请求 URL 相对路径。
 * @param {RequestInit} [options] fetch 配置。
 * @returns {Promise<void>} 请求结束后完成。
 */
async function requestWithFetch(name, path, options) {
  /** 请求开始时刻，用于计算插件延迟后的实际耗时。 */
  const startedAt = performance.now();
  /** 完整请求地址。 */
  const url = getApiUrl(path);
  try {
    /** 由浏览器或页面补丁返回的响应对象。 */
    const response = await fetch(url, options);
    /** 响应文本，用于识别 Mock 或重定向后的内容。 */
    const body = await response.text();
    /** 便于检查响应 Header 改写的关键响应头列表。 */
    const headers = ['content-type', 'x-response-patched', 'x-lab-resource']
      .map((header) => `${header}: ${response.headers.get(header) ?? '(none)'}`)
      .join('\n');
    appendLog({
      name,
      url: response.url || url,
      status: response.status,
      duration: performance.now() - startedAt,
      body: `${body}\n\n${headers}`,
      error: !response.ok,
    });
  } catch (error) {
    appendLog({
      name,
      url,
      duration: performance.now() - startedAt,
      body: error instanceof Error ? error.message : String(error),
      error: true,
    });
  }
}

/**
 * 通过 XMLHttpRequest 发起请求并记录结果。
 * @returns {Promise<void>} XHR load 或 error 后完成。
 */
function requestWithXhr() {
  return new Promise((resolve) => {
    /** XHR 测试请求的开始时刻。 */
    const startedAt = performance.now();
    /** XHR 请求目标地址。 */
    const url = getApiUrl('./api/products.json');
    /** 传统 XHR 实例，用来验证页面补丁的 XHR 分支。 */
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.setRequestHeader('X-Lab-Client', 'request-lab-xhr');
    xhr.addEventListener('loadend', () => {
      appendLog({
        name: 'XHR 商品请求',
        url,
        status: xhr.status,
        duration: performance.now() - startedAt,
        body: xhr.responseText || '(空响应)',
        error: xhr.status < 200 || xhr.status >= 300,
      });
      resolve();
    });
    xhr.send();
  });
}

/**
 * 加载用于 block 规则验证的图片资源。
 * @returns {void}
 */
function loadBlockableAsset() {
  /** 每次加载均带有时间戳，确保不会命中浏览器缓存。 */
  const source = `${getApiUrl('./assets/tracker.svg')}?request=${Date.now()}`;
  /** 动态创建的图片元素。 */
  const image = new Image();
  assetPreview.textContent = '资源加载中…';
  image.alt = '请求拦截测试资源';
  image.onload = () => {
    assetPreview.replaceChildren(image);
    appendLog({ name: '可拦截图片资源', url: source, status: 200, duration: 0, body: '图片加载成功', error: false });
  };
  image.onerror = () => {
    assetPreview.textContent = '资源加载失败（若已配置 Block 规则，这是预期结果）';
    appendLog({ name: '可拦截图片资源', url: source, duration: 0, body: '图片加载失败或被拦截', error: true });
  };
  image.src = source;
}

/**
 * 根据按钮动作分发到对应的测试请求。
 * @param {string} action 按钮上声明的测试动作。
 * @returns {Promise<void>} 动作完成后结束。
 */
async function runAction(action) {
  if (action === 'basic-fetch') return requestWithFetch('Fetch 用户请求', './api/users.json');
  if (action === 'xhr-request') return requestWithXhr();
  if (action === 'redirect') return requestWithFetch('重定向源请求', './api/redirect-source.json');
  if (action === 'params') return requestWithFetch('参数注入请求', './api/params.json?from=lab');
  if (action === 'headers') return requestWithFetch('Header 改写请求', './api/headers.json', { headers: { 'X-Lab-Client': 'request-lab-fetch', 'X-Remove-Me': 'remove-this' } });
  if (action === 'slow-response') return requestWithFetch('弱网大响应请求', './api/slow-response.txt');
  if (action === 'post-request') {
    /** 上行带宽测试所用的可读 JSON 请求体。 */
    const body = JSON.stringify({ source: 'req-freedom-request-lab', content: 'x'.repeat(UPLOAD_PAYLOAD_SIZE) });
    return requestWithFetch('POST 上行带宽请求', './api/upload-probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  }
  if (action === 'asset-block') {
    loadBlockableAsset();
  }
}

/**
 * 设置单个操作按钮的忙碌状态并执行测试。
 * @param {HTMLButtonElement} button 用户点击的按钮。
 * @returns {Promise<void>} 测试结束后恢复按钮状态。
 */
async function runButtonAction(button) {
  /** 按钮上声明的待运行动作。 */
  const action = button.dataset.action;
  if (!action) return;
  button.disabled = true;
  try {
    await runAction(action);
  } finally {
    button.disabled = false;
  }
}

/** 初始化页面交互和可见的注入状态。 */
function initializeLab() {
  locationElement.textContent = window.location.href;
  injectionValue.textContent = `window.__REQ_FREEDOM_LAB__ = ${String(window.__REQ_FREEDOM_LAB__)}`;
  document.querySelectorAll('[data-action]').forEach((element) => {
    /** 已确认是 HTML 按钮的测试操作元素。 */
    const button = /** @type {HTMLButtonElement} */ (element);
    button.addEventListener('click', () => void runButtonAction(button));
  });
  document.querySelector('#clear-log').addEventListener('click', () => {
    logList.replaceChildren();
    logCount.textContent = '0 条记录';
  });
  document.querySelector('#run-all').addEventListener('click', async (event) => {
    /** 运行全部请求的全局操作按钮。 */
    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    /** 按顺序运行的请求型测试动作。 */
    const actions = ['basic-fetch', 'xhr-request', 'redirect', 'params', 'headers', 'slow-response', 'post-request'];
    button.disabled = true;
    try {
      for (const action of actions) {
        await runAction(action);
      }
      loadBlockableAsset();
    } finally {
      button.disabled = false;
    }
  });
}

initializeLab();
