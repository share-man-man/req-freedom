import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { sendJsonError } from './http.mjs';

/** 静态资源根目录，即 request-lab package 所在目录。 */
const REQUEST_LAB_ROOT = resolve(import.meta.dirname, '..');
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
 * 将请求路径映射为根目录内的静态资源路径。
 * @param {string} pathname 请求 URL 的路径部分。
 * @returns {string | undefined} 允许读取时返回绝对文件路径，越界请求返回 undefined。
 */
function resolveStaticFile(pathname) {
  /** 根路径默认返回请求实验室的入口页。 */
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  /** 归一化后的候选文件路径。 */
  const filePath = resolve(REQUEST_LAB_ROOT, normalize(relativePath));
  /** 根目录自身和子路径的前缀，用于避免 ../ 路径穿越。 */
  const rootPrefix = `${REQUEST_LAB_ROOT}${sep}`;
  return filePath === REQUEST_LAB_ROOT || filePath.startsWith(rootPrefix) ? filePath : undefined;
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
 * 静态资源处理：路由表未命中时的兜底。
 *
 * 只接受 GET / HEAD——夹具的静态部分是只读的，写方法一律按资源不存在处理，
 * 需要动态行为的场景应注册到路由表而不是打到静态分支。
 * @param {import('./router.mjs').RequestContext} context 当前请求上下文。
 * @returns {Promise<void>} 响应结束后完成。
 */
export async function serveStatic({ response, method, pathname }) {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJsonError(response, 404, 'fixture resource not found');
    return;
  }

  /** 请求路径解析后的本地文件地址。 */
  const filePath = resolveStaticFile(pathname);
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
