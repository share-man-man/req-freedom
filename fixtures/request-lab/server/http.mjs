/** JSON 响应统一使用的内容类型。 */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** 读取请求体的默认字节上限，避免异常输入撑爆内存。 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/**
 * 发送 JSON 响应。
 *
 * 统一补 `content-length` 与 `cache-control: no-store`：夹具的响应必须每次都真实回源，
 * 否则规则改动后看到的可能是缓存结果。HEAD 请求由 Node 自动省略响应体。
 * @param {import('node:http').ServerResponse} response 当前 HTTP 响应对象。
 * @param {number} statusCode HTTP 状态码。
 * @param {unknown} payload 将被序列化为 JSON 的响应负载。
 * @param {Record<string, string | string[]>} [extraHeaders] 额外响应头（如 Set-Cookie）。
 * @returns {void}
 */
export function sendJson(response, statusCode, payload, extraHeaders = {}) {
  /** 序列化后的响应体，缩进便于在日志区直接阅读。 */
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': JSON_CONTENT_TYPE,
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders,
  });
  response.end(body);
}

/**
 * 向客户端返回统一的 JSON 错误响应。
 * @param {import('node:http').ServerResponse} response 当前 HTTP 响应对象。
 * @param {number} statusCode HTTP 状态码。
 * @param {string} message 错误说明。
 * @returns {void}
 */
export function sendJsonError(response, statusCode, message) {
  sendJson(response, statusCode, { code: statusCode, message });
}

/**
 * 读取完整的请求体文本。
 *
 * 超过上限后停止累积但继续把流读完，而不是直接销毁连接：销毁会让响应无法正常返回，
 * 夹具里更希望看到「收到了被截断的内容」而不是一个断开的请求。
 * @param {import('node:http').IncomingMessage} request 当前 HTTP 请求。
 * @param {number} [maxBytes] 累积的字节上限。
 * @returns {Promise<string>} 请求体的 UTF-8 文本；超限时返回已累积的部分。
 */
export function readRequestBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    /** 已接收的请求体分片。 */
    const chunks = [];
    /** 已累积的字节数，用于超限保护。 */
    let receivedBytes = 0;
    request.on('data', (chunk) => {
      // 超限后只丢弃后续分片，仍把流读完以保证 end 事件正常触发
      if (receivedBytes >= maxBytes) {
        return;
      }
      receivedBytes += chunk.byteLength;
      chunks.push(chunk);
    });
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    request.on('error', rejectPromise);
  });
}

/**
 * 读取请求体并在其为合法 JSON 时一并给出解析结果。
 * @param {import('node:http').IncomingMessage} request 当前 HTTP 请求。
 * @returns {Promise<{ text: string, json: unknown | undefined }>} 原始文本与解析结果。
 */
export async function readJsonBody(request) {
  /** 服务端实际收到的请求体文本。 */
  const text = await readRequestBody(request);
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    // 非 JSON 请求体属正常情况（如被整体替换成纯文本），仅返回原始文本
    return { text, json: undefined };
  }
}
