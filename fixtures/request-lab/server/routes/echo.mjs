import { readJsonBody, sendJson } from '../http.mjs';

/**
 * 请求回显：把服务端实际收到的方法、查询参数、请求头与请求体原样返回。
 *
 * 这是夹具里的主力端点——改请求体、Header 改写、UA 切换、动态变量这些能力，
 * 都只有「看到服务端真正收到什么」才能验证。不限制请求方法且一律返回 200：
 * 夹具不该用 405 把请求挡在门外，否则「规则没命中」和「方法不被接受」会混在一起难以排查。
 * 无请求体的方法（GET / HEAD）回显空串，负载结构保持一致。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {Promise<void>} 响应结束后完成。
 */
export async function handleEcho({ request, response, url, method }) {
  /** 服务端实际收到的请求体（原始文本 + 可选的 JSON 解析结果）。 */
  const body = await readJsonBody(request);
  /**
   * 回显负载。
   *
   * 字段顺序刻意按「重要性」排：页面日志会截断过长文本，把 receivedBody / receivedJson 放在
   * 体量大的 headers 之前，才能保证最关键的回显内容不被截掉。
   */
  const payload = {
    method,
    contentType: request.headers['content-type'] ?? null,
    receivedBody: body.text,
    byteLength: Buffer.byteLength(body.text),
  };
  // 请求体是合法 JSON 时附带解析结果，便于直接核对 JSON 深合并效果
  if (body.json !== undefined) {
    payload.receivedJson = body.json;
  }
  payload.query = Object.fromEntries(url.searchParams);
  payload.headers = request.headers;
  sendJson(response, 200, payload);
}
