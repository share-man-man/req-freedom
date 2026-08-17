/**
 * 按 .store-assets/config.json 的 shots 逐张渲染素材，输出严格等于声明的像素尺寸。
 *
 * 本脚本自带静态服务器、自己拉起无头 Chrome、结束时一并收掉。这样做是因为
 * 常驻的服务器 / 浏览器会残留在机器上占端口，跨会话互相干扰；而且固定端口
 * 在并行跑或本机已占用时会直接失败——这里两个端口都交给系统分配。
 *
 * 走 CDP 而不是 `chrome --headless --screenshot`：后者要靠
 * `--virtual-time-budget` 等页面稳定，而页面里只要有个持续调度的组件
 * （代码编辑器、动画、轮询），虚拟时间就迟迟推进不完，进程直接挂死。
 * 连 CDP 就能显式地「锁死视口 → 导航 → 等页面自报就绪 → 拍」。
 *
 * 用法：
 *   node capture.mjs              # 出全部素材
 *   node capture.mjs 01 promo     # 只出文件名含 01 或 promo 的
 *
 * 环境变量：
 *   CHROME_BIN           Chrome 可执行文件路径
 *   STORE_ASSETS_PARAMS  追加到每个页面的查询参数，如 'locale=zh-CN&theme=dark'
 *                        （覆盖 config.json 的 defaultParams，由 seed.js 解读）
 */
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

/** 仓库根目录。 */
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
/** 出图配置。 */
const config = JSON.parse(readFileSync(join(repoRoot, '.store-assets/config.json'), 'utf-8'));
/** 演示站点目录，由 prepare.sh 组装。 */
const siteDir = join(repoRoot, config.workDir, 'site');
/** 素材输出目录。 */
const outDir = join(repoRoot, config.workDir, 'out');

/** Chrome 可执行文件路径。 */
const chromeBin =
  process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 页面自报就绪的最长等待时间（毫秒）。 */
const READY_TIMEOUT_MS = 20000;
/** 就绪之后再留给合成与重排的时间（毫秒）。 */
const SETTLE_MS = 500;
/** 等 Chrome 写出调试端口的最长时间（毫秒）。 */
const CHROME_BOOT_TIMEOUT_MS = 20000;

/** 常见静态资源的 Content-Type。 */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  // 扩展常要拉一份真实素材文件来渲染（阅读器、预览器一类），
  // Content-Type 必须给对，否则页面会按"类型不支持"走错误分支
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * 等待指定毫秒。
 * @param ms 毫秒数
 * @returns 到时兑现的 Promise
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动托管演示站点的静态服务器。
 * @param root 站点根目录
 * @returns 服务器实例与实际监听端口
 */
function startServer(root) {
  /** 静态文件服务器。 */
  const server = createServer((req, res) => {
    /** 去掉查询串后的请求路径。 */
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    // normalize 之后再拼接，避免 ../ 穿出站点目录
    const filePath = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!existsSync(filePath) || filePath.endsWith('/')) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      // 页面改完立刻重跑是常态，缓存只会让人对着旧图调半天
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // 端口交给系统分配，避免与本机已有服务冲突
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * 拉起无头 Chrome，并取到它实际监听的调试端口。
 * @returns Chrome 进程、调试端口与临时 profile 目录
 */
async function startChrome() {
  /** Chrome 的一次性用户数据目录。 */
  const profileDir = mkdtempSync(join(tmpdir(), 'store-assets-chrome-'));
  /** Chrome 子进程。 */
  const child = spawn(
    chromeBin,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      // 端口给 0，让 Chrome 自己挑，端口号写在 DevToolsActivePort 里
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  /** DevToolsActivePort 文件路径，第一行是实际端口。 */
  const portFile = join(profileDir, 'DevToolsActivePort');
  /** 开始等待的时间戳。 */
  const startedAt = Date.now();
  while (Date.now() - startedAt < CHROME_BOOT_TIMEOUT_MS) {
    if (existsSync(portFile)) {
      /** 文件首行给出的调试端口。 */
      const port = Number(readFileSync(portFile, 'utf-8').split('\n')[0]);
      if (Number.isFinite(port) && port > 0) return { child, port, profileDir };
    }
    await sleep(150);
  }
  child.kill('SIGKILL');
  rmSync(profileDir, { recursive: true, force: true });
  throw new Error(`Chrome 未能在 ${CHROME_BOOT_TIMEOUT_MS}ms 内就绪（CHROME_BIN=${chromeBin}）`);
}

/**
 * 一个 CDP 会话的极简封装：按 id 收发 JSON-RPC。
 *
 * 只用到 4 个命令，为此引入 puppeteer 不划算；Node 22 自带 WebSocket，零依赖。
 */
class CdpSession {
  /**
   * @param webSocketUrl 目标页面的 CDP WebSocket 地址
   */
  constructor(webSocketUrl) {
    /** 底层 WebSocket 连接。 */
    this.socket = new WebSocket(webSocketUrl);
    /** 自增的消息 ID。 */
    this.nextId = 1;
    /** 等待响应的请求表。 */
    this.pending = new Map();
    this.socket.addEventListener('message', (event) => {
      /** 解析后的 CDP 消息。 */
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        /** 该消息对应的 Promise 回调。 */
        const settle = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) settle.reject(new Error(payload.error.message));
        else settle.resolve(payload.result);
      }
    });
  }

  /**
   * 等待连接就绪。
   * @returns 连接打开后兑现
   */
  ready() {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }

  /**
   * 发送一条 CDP 命令。
   * @param method 命令名
   * @param params 命令参数
   * @returns 命令结果
   */
  send(method, params = {}) {
    /** 本次请求的 ID。 */
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 关闭连接。 */
  close() {
    this.socket.close();
  }
}

/**
 * 轮询页面自报的就绪标记。
 * @param session CDP 会话
 * @returns 是否在超时前就绪
 */
async function waitForReady(session) {
  /** 开始等待的时间戳。 */
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    /** 就绪标记的求值结果。 */
    const result = await session.send('Runtime.evaluate', {
      expression: 'window.__assetReady === true',
      returnByValue: true,
    });
    if (result?.result?.value === true) {
      // autoview 即使交互失败也会置就绪（拍张能看出问题的图好过干等），
      // 失败原因留在 __assetError 里。这里必须读出来向上报，
      // 否则一张内容不对的图会被标成成功。
      const failure = await session.send('Runtime.evaluate', {
        expression: 'window.__assetError ?? null',
        returnByValue: true,
      });
      return { ready: true, error: failure?.result?.value ?? null };
    }
    await sleep(200);
  }
  return { ready: false, error: '等待就绪超时' };
}

/**
 * 给素材路径补上公共查询参数。
 * @param path config.json 中声明的页面路径
 * @param baseUrl 演示站点根地址
 * @returns 实际导航使用的完整 URL
 */
function buildUrl(path, baseUrl) {
  // 站点端口是每次运行临时分配的，配置里写不了绝对地址。页面需要把站点上的
  // 另一个文件当成外部资源去 fetch 时（阅读器类扩展的 ?src= 就是这样），
  // 在 config.json 里写 {{baseUrl}}，这里替换成本次的真实地址。
  /** 展开 {{baseUrl}} 之后的路径。 */
  const resolvedPath = path.replaceAll('{{baseUrl}}', baseUrl);
  /** 基于演示站点解析出的可写 URL 对象。 */
  const url = new URL(resolvedPath, baseUrl);
  for (const [key, value] of Object.entries(config.defaultParams ?? {})) {
    url.searchParams.set(key, String(value));
  }
  for (const [key, value] of new URLSearchParams(process.env.STORE_ASSETS_PARAMS ?? '')) {
    url.searchParams.set(key, value);
  }
  return url.href;
}

/**
 * 截取一张素材。
 * @param shot 素材定义（输出文件名、页面路径与画布尺寸）
 * @param context 运行上下文（调试端口与站点地址）
 * @returns 该张是否在超时前就绪
 */
async function capture(shot, context) {
  /** 新建标签页后拿到的目标信息。 */
  const target = await fetch(`http://127.0.0.1:${context.cdpPort}/json/new?about:blank`, {
    method: 'PUT',
  }).then((response) => response.json());

  /** 与该标签页的 CDP 会话。 */
  const session = new CdpSession(target.webSocketDebuggerUrl);
  try {
    await session.ready();
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    // 锁死视口，保证输出严格等于声明的尺寸
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session.send('Page.navigate', { url: buildUrl(shot.path, context.baseUrl) });

    /** 就绪结果：是否就绪，以及页面自报的失败原因。 */
    const outcome = await waitForReady(session);
    await sleep(SETTLE_MS);

    /** 截图结果（base64 PNG）。 */
    const screenshot = await session.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(join(outDir, shot.file), Buffer.from(screenshot.data, 'base64'));
    return outcome;
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${context.cdpPort}/json/close/${target.id}`);
  }
}

/** 命令行传入的文件名筛选片段。 */
const filters = process.argv.slice(2);
/** 本次要产出的素材列表。 */
const shots = (config.shots ?? []).filter(
  (shot) => filters.length === 0 || filters.some((filter) => shot.file.includes(filter)),
);

if (shots.length === 0) {
  console.error(filters.length ? `没有匹配的素材：${filters.join(' ')}` : 'config.json 里没有 shots');
  process.exit(1);
}
if (!existsSync(join(siteDir, 'manifest.json'))) {
  console.error(`演示站点不存在：${siteDir}\n先跑 scripts/prepare.sh`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

/** 静态服务器实例与端口。 */
const { server, port } = await startServer(siteDir);
/** 无头 Chrome 进程、调试端口与临时 profile。 */
const chrome = await startChrome();
/** 有问题的素材：没等到就绪，或页面报告交互失败。 */
const problems = [];

try {
  for (const shot of shots) {
    /** 该张的就绪结果。 */
    const outcome = await capture(shot, {
      cdpPort: chrome.port,
      baseUrl: `http://127.0.0.1:${port}`,
    });
    /** 本张是否可信。 */
    const ok = outcome.ready && !outcome.error;
    if (!ok) problems.push(`${shot.file}：${outcome.error ?? '未就绪'}`);
    console.log(
      `${ok ? '✓' : '!'} ${shot.file}  ${shot.width}x${shot.height}  ${shot.note ?? ''}`,
    );
  }
} finally {
  // 无论成败都收干净，别把浏览器和端口留在机器上
  chrome.child.kill('SIGKILL');
  rmSync(chrome.profileDir, { recursive: true, force: true });
  server.close();
}

console.log(`\n输出目录：${outDir}`);
if (problems.length > 0) {
  console.error(`\n以下素材可能拍到了错误内容，务必人工核对：\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
