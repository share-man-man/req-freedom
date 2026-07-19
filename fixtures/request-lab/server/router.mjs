import { sendJsonError } from './http.mjs';

/**
 * 单条请求的上下文，路由处理函数的唯一入参。
 * @typedef {object} RequestContext
 * @property {import('node:http').IncomingMessage} request 原始 HTTP 请求。
 * @property {import('node:http').ServerResponse} response 原始 HTTP 响应。
 * @property {URL} url 解析后的完整请求 URL（含查询串）。
 * @property {string} method 规范化后的请求方法。
 * @property {string} pathname 请求路径部分。
 */

/**
 * 一条路由定义。
 * @typedef {object} Route
 * @property {string} method 允许的请求方法；`*` 表示任意方法。
 * @property {string} path 匹配路径；以 `/*` 结尾表示前缀匹配。
 * @property {string} description 用途说明，仅供启动日志与文档使用。
 * @property {(context: RequestContext) => Promise<void> | void} handler 处理函数。
 */

/**
 * 判断请求方法是否命中路由。
 *
 * HEAD 复用 GET 路由，符合 HTTP 语义：HEAD 应当返回与 GET 一致的响应头。
 * @param {Route} route 待匹配路由。
 * @param {string} method 当前请求方法。
 * @returns {boolean} 命中返回 true。
 */
function matchesMethod(route, method) {
  return (
    route.method === '*' ||
    route.method === method ||
    (method === 'HEAD' && route.method === 'GET')
  );
}

/**
 * 判断请求路径是否命中路由。
 * @param {Route} route 待匹配路由。
 * @param {string} pathname 当前请求路径。
 * @returns {boolean} 命中返回 true。
 */
function matchesPath(route, pathname) {
  // 以 /* 结尾的路由做前缀匹配，用于 /api/status/500 这类把参数放在路径里的端点
  if (route.path.endsWith('/*')) {
    return pathname.startsWith(route.path.slice(0, -1));
  }
  return route.path === pathname;
}

/**
 * 创建 HTTP 请求处理函数：先查路由表，未命中再交给兜底处理。
 * @param {object} options 处理器配置。
 * @param {Route[]} options.routes 路由表，按顺序匹配，先注册者优先。
 * @param {(context: RequestContext) => Promise<void> | void} [options.fallback] 未命中路由时的兜底处理。
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>} 可直接交给 createServer 的处理函数。
 */
export function createRequestHandler({ routes, fallback }) {
  return async function handleRequest(request, response) {
    /** 解析后的完整请求 URL；host 仅用于补全，不参与路由判断。 */
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    /** 当前请求上下文。 */
    const context = {
      request,
      response,
      url,
      method: request.method ?? 'GET',
      pathname: url.pathname,
    };

    try {
      /** 首个同时命中方法与路径的路由。 */
      const route = routes.find(
        (item) => matchesPath(item, context.pathname) && matchesMethod(item, context.method),
      );
      if (route) {
        await route.handler(context);
        return;
      }
      if (fallback) {
        await fallback(context);
        return;
      }
      sendJsonError(response, 404, 'fixture resource not found');
    } catch (error) {
      // 夹具里任何未预期错误都应以可读的 500 返回，而不是让连接静默挂起
      console.error(`[request-lab] ${context.method} ${context.pathname} failed:`, error);
      if (!response.headersSent) {
        sendJsonError(response, 500, 'fixture handler failed');
      } else {
        response.end();
      }
    }
  };
}
