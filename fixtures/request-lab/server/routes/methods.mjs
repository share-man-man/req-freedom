import { readRequestBody, sendJson } from '../http.mjs';

/**
 * 方法探针：同一路径下按请求方法给出可区分的响应。
 *
 * 「Method 过滤」要验证的是「同 URL 不同方法命中不同规则」，因此这里刻意让路径固定、
 * 只有方法在变，响应里回显方法本身，页面日志一眼能看出规则作用在了哪个方法上。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {Promise<void>} 响应结束后完成。
 */
export async function handleMethods({ request, response, method }) {
  /** 请求体文本；GET / DELETE 通常为空，POST / PUT 用于确认改写是否同时生效。 */
  const receivedBody = await readRequestBody(request);
  sendJson(response, 200, {
    method,
    message: `服务端以 ${method} 方法处理了本次请求`,
    receivedBody,
  });
}
