import { sendJson } from '../http.mjs';
import { handleCookies } from './cookies.mjs';
import { handleCrossOriginAllowed, handleCrossOriginBlocked } from './cross-origin.mjs';
import { handleEcho } from './echo.mjs';
import { handleGraphql } from './graphql.mjs';
import { handleMethods } from './methods.mjs';
import { handleStatus } from './status.mjs';

/**
 * 构建主站点（默认 4317）的路由表。
 *
 * 路由按顺序匹配，未命中者回落到静态资源服务；`api/*.json` 等静态夹具数据
 * 仍以文件形式存在，只有需要动态行为的端点才注册到这里。
 * @param {object} options 路由表配置。
 * @param {string} options.crossOriginBaseUrl 跨域验证服务的基地址，供页面发现使用。
 * @returns {import('../router.mjs').Route[]} 主站点路由表。
 */
export function createLabRoutes({ crossOriginBaseUrl }) {
  return [
    {
      method: 'GET',
      path: '/api/config',
      description: '页面运行时配置（跨域服务地址等）',
      handler: ({ response }) => sendJson(response, 200, { crossOriginBaseUrl }),
    },
    {
      method: '*',
      path: '/api/echo',
      description: '回显方法 / 查询 / 请求头 / 请求体',
      handler: handleEcho,
    },
    {
      method: '*',
      path: '/api/methods',
      description: '按请求方法差异化响应',
      handler: handleMethods,
    },
    {
      method: 'POST',
      path: '/api/graphql',
      description: '按 operationName 区分的 GraphQL 式端点',
      handler: handleGraphql,
    },
    {
      method: 'GET',
      path: '/api/cookies',
      description: '回显 Cookie 请求头并下发 Set-Cookie',
      handler: handleCookies,
    },
    {
      method: '*',
      path: '/api/status/*',
      description: '按路径返回任意 HTTP 状态码',
      handler: handleStatus,
    },
  ];
}

/**
 * 构建跨域验证服务（默认 4318）的路由表。
 *
 * 该服务只承载跨域相关端点，不提供静态资源——它存在的唯一目的是提供一个**不同源**的目标。
 * @returns {import('../router.mjs').Route[]} 跨域服务路由表。
 */
export function createCrossOriginRoutes() {
  return [
    {
      method: 'GET',
      path: '/api/cross-origin/blocked',
      description: '不带 CORS 头，浏览器会拦下（待规则解除）',
      handler: handleCrossOriginBlocked,
    },
    {
      method: 'GET',
      path: '/api/cross-origin/allowed',
      description: '主动放行 CORS 的对照端点',
      handler: handleCrossOriginAllowed,
    },
  ];
}
