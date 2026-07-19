import { sendJson } from '../http.mjs';

/**
 * 服务端固定下发的一组 Cookie。
 *
 * 三条刻意覆盖三种可见性，便于验证 Set-Cookie 改写时对各属性的处理：
 * - `lab_visible`：`Path=/`，页面 `document.cookie` 里能直接看到；
 * - `lab_scoped`：`Path=/api`，只在接口路径下回传，页面读不到；
 * - `lab_session`：`HttpOnly`，任何路径下 JS 都读不到，只能在 Network 面板核对。
 *
 * 三条都会出现在下一次请求的 `Cookie` 请求头里（受 Path 约束），故回显字段能完整体现。
 * 刻意不加 Secure：夹具跑在 http://127.0.0.1 上，带 Secure 的 Cookie 不会被浏览器接受。
 */
const ISSUED_COOKIES = [
  'lab_visible=visible-value; Path=/',
  'lab_scoped=scoped-value; Path=/api',
  'lab_session=session-value; Max-Age=600; HttpOnly',
];

/**
 * Cookie 双向探针：回显收到的 Cookie 请求头，同时下发一组 Set-Cookie。
 *
 * 一个端点覆盖两个方向——`Cookie` 请求头改写看 `receivedCookie`，
 * `Set-Cookie` 响应头改写看响应头本身（页面日志会打印全部可读响应头）。
 * 注意 HttpOnly 的 Cookie 不会出现在 document.cookie 里，需在 Network 面板核对。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {void}
 */
export function handleCookies({ request, response }) {
  sendJson(
    response,
    200,
    {
      receivedCookie: request.headers.cookie ?? null,
      issuedCookies: ISSUED_COOKIES,
    },
    { 'set-cookie': ISSUED_COOKIES },
  );
}
