import { readRequestBody, sendJson } from '../http.mjs';

/**
 * 上行带宽探针：读完整个请求体后回报服务端实际收到的字节数。
 *
 * 页面用它验证限速规则的**上行**表现，因此必须把请求体完整读完再响应——若提前返回，
 * 浏览器侧的上传耗时就测不出来。回显字节数而非内容：探针载荷是无意义的填充字符，
 * 打印出来只会淹没页面日志。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {Promise<void>} 响应结束后完成。
 */
export async function handleUploadProbe({ request, response, method }) {
  /** 服务端开始读取请求体的时刻。 */
  const startedAt = Date.now();
  /** 服务端实际收到的请求体文本。 */
  const body = await readRequestBody(request);
  sendJson(response, 200, {
    method,
    receivedBytes: Buffer.byteLength(body),
    declaredContentLength: Number(request.headers['content-length']) || null,
    uploadDurationMs: Date.now() - startedAt,
  });
}
