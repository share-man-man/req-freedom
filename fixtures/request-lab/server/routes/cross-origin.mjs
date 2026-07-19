import { sendJson } from '../http.mjs';

/**
 * 跨域端点（**故意不发 CORS 头**）。
 *
 * 这是「解除 CORS」预设的验证目标：主站点在 4317，本服务在 4318，端口不同即不同源。
 * 浏览器发出的请求能到达服务端并正常返回，但因响应缺少 `Access-Control-Allow-Origin`，
 * 页面 JS 读不到响应，fetch 以 TypeError 失败——这正是需要用 Header 改写规则补上该响应头来解决的场景。
 *
 * 注意：CORS 由浏览器在网络层裁决，页面补丁通道（MAIN world）看不到被拦下的响应，
 * 因此这个场景只能由 DNR 通道的响应头改写来解除。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {void}
 */
export function handleCrossOriginBlocked({ response }) {
  sendJson(response, 200, {
    origin: 'cross-origin-lab',
    message: '响应本身正常返回，但未携带 Access-Control-Allow-Origin，浏览器会拦下它',
    hint: '用 Header 改写规则给响应补 Access-Control-Allow-Origin: * 即可读到本内容',
  });
}

/**
 * 跨域端点（**主动放行 CORS**）。
 *
 * 作为对照组存在：它能被页面正常读取，用来证明服务确实在跑、端口也通，
 * 从而把「跨域被拦」和「服务没起来 / 地址写错」两类失败区分开。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {void}
 */
export function handleCrossOriginAllowed({ response }) {
  sendJson(
    response,
    200,
    {
      origin: 'cross-origin-lab',
      message: '本端点主动放行 CORS，无需任何规则即可读到',
    },
    { 'access-control-allow-origin': '*' },
  );
}
