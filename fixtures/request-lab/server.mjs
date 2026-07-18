import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';

/** 静态资源根目录，即当前 package 所在目录。 */
const REQUEST_LAB_ROOT = resolve(import.meta.dirname);
/** 默认开发服务端口，可通过 PORT 环境变量覆盖。 */
const DEFAULT_PORT = 4317;
/** 用于确认监听端口的最大端口值。 */
const MAX_PORT = 65_535;
/** 需要扩展为大响应体的弱网验证资源路径。 */
const SLOW_RESPONSE_PATH = resolve(REQUEST_LAB_ROOT, 'api/slow-response.txt');
/** 弱网验证资源的最小响应体大小，Slow 3G 下下载约需十秒。 */
const SLOW_RESPONSE_MINIMUM_BYTES = 512 * 1024;
/** 开发服务支持的常见静态资源类型。 */
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 获取有效的监听端口；无效的 PORT 会回退到默认值。
 * @returns {number} 可供本地服务器监听的端口。
 */
function getPort() {
  /** 从环境变量读取的候选端口。 */
  const configuredPort = Number(process.env.PORT);
  return Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= MAX_PORT
    ? configuredPort
    : DEFAULT_PORT;
}

/**
 * 将请求 URL 映射为根目录内的静态资源路径。
 * @param {string | undefined} requestUrl HTTP 请求 URL。
 * @returns {string | undefined} 允许读取时返回绝对文件路径，越界请求返回 undefined。
 */
function resolveStaticFile(requestUrl) {
  /** 只使用路径部分，忽略 URL 查询参数以支持参数注入验证。 */
  const pathname = new URL(requestUrl ?? '/', 'http://127.0.0.1').pathname;
  /** 根路径默认返回请求实验室的入口页。 */
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  /** 归一化后的候选文件路径。 */
  const filePath = resolve(REQUEST_LAB_ROOT, normalize(relativePath));
  /** 根目录自身和子路径的前缀，用于避免 ../ 路径穿越。 */
  const rootPrefix = `${REQUEST_LAB_ROOT}${sep}`;
  return filePath === REQUEST_LAB_ROOT || filePath.startsWith(rootPrefix) ? filePath : undefined;
}

/**
 * 向客户端返回统一的 JSON 错误响应。
 * @param {import('node:http').ServerResponse} response 当前 HTTP 响应对象。
 * @param {number} statusCode HTTP 状态码。
 * @param {string} message 错误说明。
 * @returns {void}
 */
function sendJsonError(response, statusCode, message) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ code: statusCode, message }));
}

/**
 * 生成用于下行限速验证的大文本响应体。
 *
 * 保留小型模板文件，避免仓库纳入大量重复文本；开发服务器在响应阶段重复模板，
 * 因此浏览器实际接收的字节数与普通大资源一致。
 * @param {Buffer} body slow-response.txt 的原始模板内容。
 * @returns {Buffer} 至少为 SLOW_RESPONSE_MINIMUM_BYTES 的响应体。
 */
function createSlowResponseBody(body) {
  if (body.byteLength >= SLOW_RESPONSE_MINIMUM_BYTES) {
    return body;
  }
  /** 达到最小响应大小需要重复模板的次数。 */
  const repeatCount = Math.ceil(SLOW_RESPONSE_MINIMUM_BYTES / body.byteLength);
  /** 拼接后的响应体，尾部截断到精确的目标字节数。 */
  const expandedBody = Buffer.concat(Array.from({ length: repeatCount }, () => body));
  return expandedBody.subarray(0, SLOW_RESPONSE_MINIMUM_BYTES);
}

/**
 * 读取并按需扩展资源响应体。
 * @param {string} filePath 请求对应的本地资源路径。
 * @returns {Promise<Buffer>} 最终将发送给浏览器的响应体。
 */
async function getResponseBody(filePath) {
  /** 磁盘中读取到的原始静态资源内容。 */
  const body = await readFile(filePath);
  return filePath === SLOW_RESPONSE_PATH ? createSlowResponseBody(body) : body;
}

/**
 * 处理开发服务器静态文件请求。
 * @param {import('node:http').IncomingMessage} request 当前 HTTP 请求。
 * @param {import('node:http').ServerResponse} response 当前 HTTP 响应对象。
 * @returns {Promise<void>} 响应结束后完成。
 */
async function handleRequest(request, response) {
  /** 仅允许静态验证页需要的 GET 与 HEAD 请求。 */
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendJsonError(response, 404, 'fixture resource not found');
    return;
  }

  /** 请求路径解析后的本地文件地址。 */
  const filePath = resolveStaticFile(request.url);
  if (!filePath) {
    sendJsonError(response, 403, 'forbidden path');
    return;
  }

  try {
    /** 读取文件元数据，确保目录不能被作为资源返回。 */
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJsonError(response, 404, 'fixture resource not found');
      return;
    }
    /** 实际资源响应体，弱网资源会在内存中扩展至 512 KB。 */
    const resourceBody = await getResponseBody(filePath);
    /** GET 返回资源内容，HEAD 只返回与 GET 一致的响应头。 */
    const body = method === 'GET' ? resourceBody : undefined;
    /** 根据扩展名推断的资源 Content-Type。 */
    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentType,
      'content-length': String(resourceBody.byteLength),
      'x-lab-resource': 'static-node',
    });
    response.end(body);
  } catch {
    sendJsonError(response, 404, 'fixture resource not found');
  }
}

/** 当前 Request Lab 开发服务器实例。 */
const server = createServer((request, response) => void handleRequest(request, response));
/** 当前 Request Lab 开发服务监听的端口。 */
const port = getPort();

server.listen(port, '127.0.0.1', () => {
  console.log(`\n  Req Freedom Request Lab\n  http://127.0.0.1:${port}\n`);
});
