/** 当前页面暴露给注入脚本读取和修改的实验室状态。 */
window.__REQ_FREEDOM_LAB__ = window.__REQ_FREEDOM_LAB__ ?? '页面默认值';

/** 请求日志的最大保留条数，避免长时间测试导致页面无限增长。 */
const MAX_LOG_ITEMS = 30;
/** SSE 卡片最多保留的事件条数，避免重复调试时列表无限增长。 */
const MAX_SSE_EVENT_ITEMS = 50;
/** 手动 SSE Mock 规则命中的固定请求路径。 */
const MANUAL_SSE_PATH = './api/manual-sse';
/** 用于上行带宽测试的 JSON 请求体大小（字符数近似字节数）。 */
const UPLOAD_PAYLOAD_SIZE = 16 * 1024;
/**
 * 改请求体测试所用的原始请求体。
 *
 * 结构对齐 GraphQL 的常见形态（query + variables），方便直接验证 JSON 深合并只覆盖目标字段、
 * 其余字段（如 after）原样保留。
 */
const MODIFY_BODY_PAYLOAD = {
  query: 'ListItems',
  variables: { first: 10, after: 'cursor-0' },
};
/**
 * GraphQL 验证用的两个操作请求体。
 *
 * 两者 URL 与方法完全相同，只有 operationName 不同——这正是仅靠 URL 匹配无法区分的场景。
 */
const GRAPHQL_OPERATIONS = {
  ListItems: { operationName: 'ListItems', query: 'query ListItems { items { id name } }', variables: { first: 10 } },
  GetUser: { operationName: 'GetUser', query: 'query GetUser { user { id name role } }', variables: { id: 7 } },
};
/** 各请求动作对应的验证卡片标识。 */
const CARD_TEST_BY_ACTION = {
  'asset-block': 'asset-block',
  'basic-fetch': 'basic-fetch',
  'xhr-request': 'xhr-request',
  redirect: 'redirect',
  params: 'params',
  headers: 'headers',
  cookies: 'cookies',
  'cors-blocked': 'cors',
  'cors-allowed': 'cors',
  'invalid-rule': 'invalid-rule',
  'opaque-response': 'opaque-response',
  'sync-xhr': 'sync-xhr',
  'methods-get': 'methods',
  'methods-post': 'methods',
  'methods-delete': 'methods',
  'status-404': 'status',
  'status-500': 'status',
  'slow-response': 'slow-response',
  'post-request': 'post-request',
  'modify-body-fetch': 'modify-request-body',
  'modify-body-xhr': 'modify-request-body',
  'graphql-list': 'graphql',
  'graphql-user': 'graphql',
};
/** 跨域验证服务的基地址，由 /api/config 在初始化时下发。 */
let crossOriginBaseUrl = '';
/** 当前仍在读取的 Fetch SSE 请求控制器。 */
let sseFetchAbortController = null;
/** 当前 Fetch SSE 响应体的读取器，用于停止时取消自定义 Mock 流。 */
let sseFetchReader = null;
/** 当前仍保持打开的 EventSource 实例。 */
let sseEventSource = null;
/** 本次页面会话累计收到的 SSE 事件数量。 */
let sseReceivedEventCount = 0;

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
/** 跨域卡片上用于展示实际跨域地址的元素。 */
const crossOriginBaseElement = document.querySelector('#cors-base');
/** Fetch SSE 启动按钮。 */
const sseFetchStartButton = document.querySelector('#sse-fetch-start');
/** Fetch SSE 停止按钮。 */
const sseFetchStopButton = document.querySelector('#sse-fetch-stop');
/** EventSource 启动按钮。 */
const sseEventSourceStartButton = document.querySelector('#sse-event-source-start');
/** EventSource 停止按钮。 */
const sseEventSourceStopButton = document.querySelector('#sse-event-source-stop');
/** SSE 事件逐条展示列表。 */
const sseEventList = document.querySelector('#sse-event-list');
/** SSE 累计事件数量展示元素。 */
const sseEventCount = document.querySelector('#sse-event-count');

/**
 * @typedef {Object} ParsedSseEvent
 * @property {string} event SSE 事件类型。
 * @property {string} data 合并多行后的事件数据。
 * @property {string} id 事件 ID；未提供时为空字符串。
 */

/**
 * 获取当前页面所在目录对应的 API 资源 URL。
 * @param {string} path API 资源的相对路径。
 * @returns {string} 可用于 fetch 或 XHR 的绝对 URL。
 */
function getApiUrl(path) {
  return new URL(path, window.location.href).toString();
}

/**
 * 从服务端拉取运行时配置，取得跨域验证服务的地址。
 *
 * 跨域服务端口可通过 CROSS_ORIGIN_PORT 覆盖，因此不能在页面里写死，
 * 由服务端下发才能保证任意端口组合下卡片都指向正确地址。
 * @returns {Promise<void>} 配置写入后完成。
 */
async function loadLabConfig() {
  try {
    /** /api/config 返回的运行时配置。 */
    const config = await (await fetch(getApiUrl('./api/config'))).json();
    crossOriginBaseUrl = config.crossOriginBaseUrl ?? '';
    crossOriginBaseElement.textContent = crossOriginBaseUrl || '跨域服务地址获取失败';
  } catch {
    crossOriginBaseElement.textContent = '跨域服务地址获取失败';
  }
}

/**
 * 拼出跨域验证服务上的完整地址。
 * @param {string} path 跨域服务上的资源路径。
 * @returns {string} 绝对 URL；配置尚未就绪时返回空串。
 */
function getCrossOriginUrl(path) {
  return crossOriginBaseUrl ? `${crossOriginBaseUrl}${path}` : '';
}

/**
 * 更新指定 SSE 客户端的连接状态文案。
 * @param {'fetch' | 'event-source'} client 要更新的客户端。
 * @param {'idle' | 'connecting' | 'connected' | 'error'} state 状态对应的视觉样式。
 * @param {string} text 用户可见的状态文案。
 * @returns {void}
 */
function setSseClientStatus(client, state, text) {
  /** 当前客户端对应的状态元素。 */
  const status = document.querySelector(`[data-sse-client-status="${client}"]`);
  if (!status) return;
  status.dataset.state = state;
  status.textContent = text;
}

/**
 * 根据两路 SSE 客户端的活动状态切换启停按钮。
 * @returns {void}
 */
function updateSseControlButtons() {
  /** Fetch 流是否仍由页面持有。 */
  const isFetchActive = sseFetchAbortController !== null;
  /** EventSource 是否仍由页面持有。 */
  const isEventSourceActive = sseEventSource !== null;
  sseFetchStartButton.disabled = isFetchActive;
  sseFetchStopButton.disabled = !isFetchActive;
  sseEventSourceStartButton.disabled = isEventSourceActive;
  sseEventSourceStopButton.disabled = !isEventSourceActive;
}

/**
 * 将一条收到的 SSE 事件追加到卡片中。
 * @param {'Fetch stream' | 'EventSource'} client 事件来源客户端。
 * @param {ParsedSseEvent} event 解析后的事件。
 * @returns {void}
 */
function appendSseEvent(client, event) {
  /** 初始空状态元素。 */
  const emptyState = sseEventList.querySelector('[data-sse-event-empty]');
  emptyState?.remove();
  sseReceivedEventCount += 1;

  /** 新事件的列表项。 */
  const item = document.createElement('li');
  /** 事件来源、类型和 ID 元信息。 */
  const meta = document.createElement('div');
  /** 事件数据正文。 */
  const data = document.createElement('div');
  /** 当前事件来源对应的接收时间展示元素。 */
  const receivedTime = document.querySelector(
    `[data-sse-received-time="${client === 'Fetch stream' ? 'fetch' : 'event-source'}"]`,
  );
  /** 当前事件到达页面的时间。 */
  const receivedAt = new Date();
  item.className = 'sse-event-item';
  meta.className = 'sse-event-meta';
  data.className = 'sse-event-data';
  meta.textContent = `#${sseReceivedEventCount} · ${client} · ${event.event}${event.id ? ` · id ${event.id}` : ''}`;
  data.textContent = event.data || '(空 data)';
  if (receivedTime) {
    receivedTime.textContent = receivedAt.toLocaleTimeString('zh-CN', { hour12: false });
    receivedTime.setAttribute('datetime', receivedAt.toISOString());
  }
  item.append(meta, data);
  sseEventList.append(item);
  while (sseEventList.children.length > MAX_SSE_EVENT_ITEMS) {
    sseEventList.firstElementChild?.remove();
  }
  sseEventCount.textContent = `${sseReceivedEventCount} 条`;
  item.scrollIntoView({ block: 'nearest' });
}

/**
 * 解析一段以空行分隔的 SSE 协议块。
 * @param {string} block 单条事件的原始协议文本。
 * @returns {ParsedSseEvent | null} 可展示的事件；只有注释或控制字段时返回 null。
 */
function parseSseEventBlock(block) {
  /** 协议块中的每一行。 */
  const lines = block.split(/\r?\n/);
  /** data 字段的多行内容。 */
  const dataLines = [];
  /** 事件类型，协议缺省值为 message。 */
  let eventType = 'message';
  /** 事件 ID，未提供时保持为空。 */
  let eventId = '';
  /** 是否至少读取到一个 data 字段。 */
  let hasData = false;

  // 逐行读取协议字段；冒号开头的心跳注释直接忽略
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    /** 当前行第一个冒号的位置。 */
    const colonIndex = line.indexOf(':');
    /** 当前协议字段名。 */
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    /** 当前协议字段值；规范允许冒号后有一个可选空格。 */
    const rawValue = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    /** 去掉协议可选前导空格后的字段值。 */
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') {
      hasData = true;
      dataLines.push(value);
    } else if (field === 'event') {
      eventType = value || 'message';
    } else if (field === 'id' && !value.includes('\0')) {
      eventId = value;
    }
  }

  if (!hasData) return null;
  return { event: eventType, data: dataLines.join('\n'), id: eventId };
}

/**
 * 从累计文本中拆出下一段完整 SSE 事件。
 * @param {string} buffer 尚未解析的流文本。
 * @returns {{block: string, rest: string} | null} 拆出的协议块与剩余文本。
 */
function takeNextSseEventBlock(buffer) {
  /** SSE 事件结尾的空行分隔符。 */
  const boundary = /\r?\n\r?\n/.exec(buffer);
  if (!boundary || boundary.index === undefined) return null;
  /** 分隔符结束后的剩余文本起点。 */
  const restIndex = boundary.index + boundary[0].length;
  return { block: buffer.slice(0, boundary.index), rest: buffer.slice(restIndex) };
}

/**
 * 通过 Fetch + ReadableStream 建立手动 SSE 连接并持续读取事件。
 * @returns {Promise<void>} 流结束、被停止或请求失败后完成。
 */
async function startSseFetch() {
  if (sseFetchAbortController) return;
  /** 只控制本次 Fetch 流的中止器。 */
  const abortController = new AbortController();
  sseFetchAbortController = abortController;
  setSseClientStatus('fetch', 'connecting', '连接中…');
  updateSseControlButtons();

  try {
    /** 命中手动 SSE Mock 规则的请求地址。 */
    const url = getApiUrl(MANUAL_SSE_PATH);
    /** 由页面补丁返回的 SSE 响应。 */
    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('响应没有可读取的流');
    }
    if (sseFetchAbortController !== abortController) {
      // 页面在 Mock Response 建立前已停止时，主动取消其响应体以释放扩展侧会话
      await response.body.cancel().catch(() => undefined);
      return;
    }
    setSseClientStatus('fetch', 'connected', '已连接，等待发送');

    /** SSE 响应体的字节读取器。 */
    const reader = response.body.getReader();
    sseFetchReader = reader;
    /** 按 UTF-8 增量解码 SSE 字节。 */
    const decoder = new TextDecoder();
    /** 跨网络分块保留的未解析文本。 */
    let pendingText = '';
    try {
      while (true) {
        /** 本次从 ReadableStream 读取的结果。 */
        const chunk = await reader.read();
        if (chunk.done) break;
        pendingText += decoder.decode(chunk.value, { stream: true });
        /** 当前可从缓存中拆出的完整事件块。 */
        let nextBlock = takeNextSseEventBlock(pendingText);
        while (nextBlock) {
          /** 完整协议块解析出的事件。 */
          const parsedEvent = parseSseEventBlock(nextBlock.block);
          if (parsedEvent) {
            appendSseEvent('Fetch stream', parsedEvent);
          }
          pendingText = nextBlock.rest;
          nextBlock = takeNextSseEventBlock(pendingText);
        }
      }
      pendingText += decoder.decode();
      if (pendingText.trim()) {
        /** 流末尾没有空行时尽量保留的最后一条事件。 */
        const trailingEvent = parseSseEventBlock(pendingText);
        if (trailingEvent) {
          appendSseEvent('Fetch stream', trailingEvent);
        }
      }
    } finally {
      if (sseFetchReader === reader) {
        sseFetchReader = null;
      }
      reader.releaseLock();
    }
    if (sseFetchAbortController === abortController) {
      setSseClientStatus('fetch', 'idle', '连接已结束');
    }
  } catch (error) {
    if (sseFetchAbortController !== abortController) return;
    /** 本次读取失败是否来自用户主动停止。 */
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    setSseClientStatus(
      'fetch',
      aborted ? 'idle' : 'error',
      aborted ? '已停止' : `失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (sseFetchAbortController === abortController) {
      sseFetchAbortController = null;
      updateSseControlButtons();
    }
  }
}

/**
 * 停止当前 Fetch SSE 流。
 * @returns {void}
 */
function stopSseFetch() {
  /** 当前仍由页面持有的 Fetch 中止器。 */
  const abortController = sseFetchAbortController;
  if (!abortController) return;
  /** 当前自定义 SSE 响应流的读取器。 */
  const reader = sseFetchReader;
  sseFetchAbortController = null;
  sseFetchReader = null;
  // 自定义 Response 在 fetch 已返回后不会继续响应 AbortSignal，需直接取消读取器
  void reader?.cancel().catch(() => {});
  abortController.abort();
  setSseClientStatus('fetch', 'idle', '已停止');
  updateSseControlButtons();
}

/**
 * 通过原生 EventSource 接口建立手动 SSE 连接。
 * @returns {void}
 */
function startSseEventSource() {
  if (sseEventSource) return;
  /** 命中手动 SSE Mock 规则的 EventSource。 */
  const source = new EventSource(getApiUrl(MANUAL_SSE_PATH));
  sseEventSource = source;
  setSseClientStatus('event-source', 'connecting', '连接中…');
  updateSseControlButtons();

  source.addEventListener('open', () => {
    if (sseEventSource !== source) return;
    setSseClientStatus('event-source', 'connected', '已连接，等待发送');
  });
  source.addEventListener('message', (event) => {
    if (sseEventSource !== source) return;
    /** EventSource 派发的标准消息事件。 */
    const message = /** @type {MessageEvent} */ (event);
    appendSseEvent('EventSource', {
      event: message.type,
      data: String(message.data),
      id: message.lastEventId,
    });
  });
  source.addEventListener('error', () => {
    if (sseEventSource !== source) return;
    /** 浏览器是否已确认该 EventSource 不会继续重连。 */
    const closed = source.readyState === EventSource.CLOSED;
    setSseClientStatus(
      'event-source',
      closed ? 'idle' : 'error',
      closed ? '连接已结束' : '连接异常，等待重连…',
    );
    if (closed) {
      sseEventSource = null;
      updateSseControlButtons();
    }
  });
}

/**
 * 停止当前 EventSource 连接。
 * @returns {void}
 */
function stopSseEventSource() {
  /** 当前仍由页面持有的 EventSource。 */
  const source = sseEventSource;
  if (!source) return;
  sseEventSource = null;
  source.close();
  setSseClientStatus('event-source', 'idle', '已停止');
  updateSseControlButtons();
}

/**
 * 注册 SSE 卡片的独立启停操作。
 *
 * 这些按钮刻意不使用 data-action，因此不会被“运行全部请求”的通用队列收集。
 * @returns {void}
 */
function initializeSseControls() {
  sseFetchStartButton.addEventListener('click', () => void startSseFetch());
  sseFetchStopButton.addEventListener('click', stopSseFetch);
  sseEventSourceStartButton.addEventListener('click', startSseEventSource);
  sseEventSourceStopButton.addEventListener('click', stopSseEventSource);
  updateSseControlButtons();
}

/**
 * 将响应文本裁剪为便于阅读的日志摘要。
 * @param {string} body 原始响应文本。
 * @returns {string} 经过长度限制的响应文本。
 */
function summarizeBody(body) {
  /**
   * 响应日志中显示的最大字符数。
   *
   * 回显端点会带上完整请求头，内容明显长于早期的静态 JSON；上限过低会把 receivedBody
   * 这类关键字段截掉，因此放宽到足以容纳一次完整回显（日志区本身可滚动）。
   */
  const maxLength = 1600;
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
    /** 遍历全部可读响应头，便于直接在日志中核对任意 Header 改写。 */
    const headers =
      [...response.headers].map(([header, value]) => `${header}: ${value}`).join('\n') ||
      '(无可读响应头)';
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
      /** XHR 可读的全部响应头（原始文本），便于核对 Header 改写。 */
      const headers = xhr.getAllResponseHeaders().trim() || '(无可读响应头)';
      appendLog({
        name: 'XHR 商品请求',
        url,
        status: xhr.status,
        duration: performance.now() - startedAt,
        body: `${xhr.responseText || '(空响应)'}\n\n${headers}`,
        error: xhr.status < 200 || xhr.status >= 300,
      });
      resolve();
    });
    xhr.send();
  });
}

/**
 * 通过**同步** XMLHttpRequest 发起请求并记录结果。
 *
 * 同步 XHR 要求 send 返回时响应已就绪，容不下页面补丁通道的异步处理（读请求体、执行动态
 * 函数、发影子请求都要等微任务），因此扩展一律原样放行。这里刻意保留这种已被废弃的用法，
 * 就是为了验证那条 fail-open 路径：页面读到的应当是服务端的真实响应，而非规则里的 Mock。
 * @returns {void}
 */
function requestWithSyncXhr() {
  /** 请求开始时刻。 */
  const startedAt = performance.now();
  /** 请求目标地址。 */
  const url = getApiUrl('./api/sync-xhr.json');
  /** 同步 XHR 实例。 */
  const xhr = new XMLHttpRequest();
  try {
    // 第三个参数为 false 即同步模式；浏览器会在控制台给出弃用警告，属预期
    xhr.open('GET', url, false);
    xhr.send();
    appendLog({
      name: '同步 XHR 请求',
      url,
      status: xhr.status,
      duration: performance.now() - startedAt,
      body: xhr.responseText || '(空响应)',
      error: xhr.status < 200 || xhr.status >= 300,
    });
  } catch (error) {
    appendLog({
      name: '同步 XHR 请求',
      url,
      duration: performance.now() - startedAt,
      body: error instanceof Error ? error.message : String(error),
      error: true,
    });
  }
}

/**
 * 通过 fetch 提交 JSON 请求体并记录回显结果。
 *
 * 日志同时给出页面发送前的 body 与服务端实际收到的 body：两者不一致即说明改请求体规则已生效。
 * @param {string} name 测试项目名称。
 * @param {string} path 请求 URL 相对路径。
 * @param {string} body 提交的请求体文本。
 * @returns {Promise<void>} 请求结束后完成。
 */
async function postJsonWithFetch(name, path, body) {
  /** 请求开始时刻。 */
  const startedAt = performance.now();
  /** 完整请求地址。 */
  const url = getApiUrl(path);
  try {
    /** 回显端点返回的响应对象。 */
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    /** 服务端回显的请求体内容。 */
    const echoed = await response.text();
    appendLog({
      name,
      url: response.url || url,
      status: response.status,
      duration: performance.now() - startedAt,
      body: `发送前 body：\n${body}\n\n服务端回显：\n${echoed}`,
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
 * 通过 XMLHttpRequest 提交 JSON 请求体并记录回显结果。
 *
 * 与 fetch 分支独立，用于覆盖页面补丁在 XHR 上的改请求体路径。
 * @param {string} name 测试项目名称。
 * @param {string} path 请求 URL 相对路径。
 * @param {string} body 提交的请求体文本。
 * @returns {Promise<void>} XHR loadend 后完成。
 */
function postWithXhr(name, path, body) {
  return new Promise((resolve) => {
    /** XHR 请求的开始时刻。 */
    const startedAt = performance.now();
    /** 请求目标地址。 */
    const url = getApiUrl(path);
    /** 用于验证 XHR 分支改写效果的实例。 */
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.addEventListener('loadend', () => {
      appendLog({
        name,
        url,
        status: xhr.status,
        duration: performance.now() - startedAt,
        body: `发送前 body：\n${body}\n\n服务端回显：\n${xhr.responseText || '(空响应)'}`,
        error: xhr.status < 200 || xhr.status >= 300,
      });
      resolve();
    });
    xhr.send(body);
  });
}

/**
 * 加载用于 block 规则验证的图片资源。
 * @returns {Promise<void>} 图片加载成功或失败后完成。
 */
function loadBlockableAsset() {
  return new Promise((resolve) => {
    /** 每次加载均带有时间戳，确保不会命中浏览器缓存。 */
    const source = `${getApiUrl('./assets/tracker.svg')}?request=${Date.now()}`;
    /** 动态创建的图片元素。 */
    const image = new Image();
    assetPreview.textContent = '资源加载中…';
    image.alt = '请求拦截测试资源';
    image.onload = () => {
      assetPreview.replaceChildren(image);
      appendLog({ name: '可拦截图片资源', url: source, status: 200, duration: 0, body: '图片加载成功', error: false });
      resolve();
    };
    image.onerror = () => {
      assetPreview.textContent = '资源加载失败（若已配置 Block 规则，这是预期结果）';
      appendLog({ name: '可拦截图片资源', url: source, duration: 0, body: '图片加载失败或被拦截', error: true });
      resolve();
    };
    image.src = source;
  });
}

/**
 * 更新指定验证卡片的可视化运行状态。
 * @param {string} test 卡片的 data-test 标识。
 * @param {'idle' | 'running' | 'completed' | 'failed'} state 要显示的运行状态。
 * @param {string} text 状态提示文本。
 * @returns {void}
 */
function setCardRunState(test, state, text) {
  /** 当前动作对应的验证卡片。 */
  const card = document.querySelector(`[data-test="${test}"]`);
  if (!card) return;
  /** 卡片底部的状态提示元素。 */
  const status = card.querySelector('[data-card-run-status]');
  card.dataset.runState = state;
  if (status) {
    status.textContent = text;
  }
}

/**
 * 执行一项请求测试，并同步其所属卡片的运行状态。
 * @param {string} action 按钮上声明的测试动作。
 * @returns {Promise<void>} 请求结束并更新卡片状态后完成。
 */
async function runCardAction(action) {
  /** 当前动作对应的验证卡片标识。 */
  const test = CARD_TEST_BY_ACTION[action];
  if (test) {
    setCardRunState(test, 'running', '执行中…');
  }
  try {
    await runAction(action);
    if (test) {
      setCardRunState(test, 'completed', '已执行');
    }
  } catch (error) {
    if (test) {
      setCardRunState(test, 'failed', '执行异常');
    }
    throw error;
  }
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
  if (action === 'modify-body-fetch') {
    return postJsonWithFetch('改请求体 Fetch', './api/echo', JSON.stringify(MODIFY_BODY_PAYLOAD));
  }
  if (action === 'modify-body-xhr') {
    return postWithXhr('改请求体 XHR', './api/echo', JSON.stringify(MODIFY_BODY_PAYLOAD));
  }
  if (action === 'invalid-rule') {
    return requestWithFetch('注册失败规则探针', './api/registration-probe.json');
  }
  if (action === 'methods-get') {
    return requestWithFetch('方法探针 GET', './api/methods');
  }
  if (action === 'methods-post') {
    return requestWithFetch('方法探针 POST', './api/methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'request-lab' }),
    });
  }
  if (action === 'methods-delete') {
    return requestWithFetch('方法探针 DELETE', './api/methods', { method: 'DELETE' });
  }
  if (action === 'graphql-list') {
    return postJsonWithFetch('GraphQL ListItems', './api/graphql', JSON.stringify(GRAPHQL_OPERATIONS.ListItems));
  }
  if (action === 'graphql-user') {
    return postJsonWithFetch('GraphQL GetUser', './api/graphql', JSON.stringify(GRAPHQL_OPERATIONS.GetUser));
  }
  if (action === 'cookies') {
    return requestWithFetch('Cookie 双向', './api/cookies');
  }
  if (action === 'status-404') {
    return requestWithFetch('状态码 404', './api/status/404');
  }
  if (action === 'status-500') {
    return requestWithFetch('状态码 500', './api/status/500');
  }
  if (action === 'cors-blocked') {
    // 预期失败：响应缺少 CORS 头，浏览器会在页面读取前拦下它
    return requestWithFetch('跨域 被拦端点', getCrossOriginUrl('/api/cross-origin/blocked'));
  }
  if (action === 'opaque-response') {
    // no-cors 的跨域请求必然得到不透明响应：状态码 0、响应体不可读
    return requestWithFetch('不透明响应请求', getCrossOriginUrl('/api/cross-origin/opaque'), {
      mode: 'no-cors',
    });
  }
  if (action === 'sync-xhr') {
    return requestWithSyncXhr();
  }
  if (action === 'cors-allowed') {
    return requestWithFetch('跨域 对照端点', getCrossOriginUrl('/api/cross-origin/allowed'));
  }
  if (action === 'asset-block') {
    return loadBlockableAsset();
  }
}

/**
 * 按页面中卡片与按钮的展示顺序收集全部请求动作。
 * @returns {string[]} 可按顺序串行执行的测试动作。
 */
function getCardActionsInDisplayOrder() {
  /** 依 DOM 顺序收集的请求动作。 */
  const actions = [];
  document.querySelectorAll('.card[data-test] [data-action]').forEach((element) => {
    /** 当前按钮声明的测试动作。 */
    const action = element.dataset.action;
    if (action) {
      actions.push(action);
    }
  });
  return actions;
}

/**
 * 统一切换所有卡片请求按钮的可用状态，避免批量执行时产生并发请求。
 * @param {boolean} disabled 是否禁用按钮。
 * @returns {void}
 */
function setCardActionButtonsDisabled(disabled) {
  document.querySelectorAll('.card[data-test] [data-action]').forEach((element) => {
    /** 已确认是 HTML 按钮的测试操作元素。 */
    const button = /** @type {HTMLButtonElement} */ (element);
    button.disabled = disabled;
  });
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
    await runCardAction(action);
  } finally {
    button.disabled = false;
  }
}

/**
 * 为每张请求验证卡片补充初始状态提示。
 * @returns {void}
 */
function initializeCardRunStates() {
  document.querySelectorAll('.card[data-test]').forEach((element) => {
    /** 当前验证卡片。 */
    const card = /** @type {HTMLElement} */ (element);
    /** 卡片的测试标识。 */
    const test = card.dataset.test;
    if (!test) return;
    /** 新建的底部状态提示。 */
    const status = document.createElement('div');
    status.className = 'card-run-status';
    status.dataset.cardRunStatus = '';
    status.setAttribute('aria-live', 'polite');
    status.textContent = '尚未运行';
    /** 卡片底部的操作控件，状态提示插入在其前面。 */
    const controls = [...card.children].find((child) =>
      child.matches('.button, .button-row'),
    );
    card.insertBefore(status, controls ?? null);
    setCardRunState(test, 'idle', '尚未运行');
  });
}

/** 初始化页面交互和可见的注入状态。 */
function initializeLab() {
  locationElement.textContent = window.location.href;
  void loadLabConfig();
  initializeCardRunStates();
  initializeSseControls();
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
    /** 按卡片展示顺序生成的串行执行队列。 */
    const actions = getCardActionsInDisplayOrder();
    button.disabled = true;
    setCardActionButtonsDisabled(true);
    try {
      for (const action of actions) {
        await runCardAction(action);
      }
    } finally {
      button.disabled = false;
      setCardActionButtonsDisabled(false);
    }
  });
}

initializeLab();
