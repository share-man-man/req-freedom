import { createServer } from 'node:http';
import { createRequestHandler } from './server/router.mjs';
import { createCrossOriginRoutes, createLabRoutes } from './server/routes/index.mjs';
import { serveStatic } from './server/static.mjs';

/** 主站点默认端口，可通过 PORT 环境变量覆盖。 */
const DEFAULT_PORT = 4317;
/** 跨域验证服务默认端口，可通过 CROSS_ORIGIN_PORT 环境变量覆盖。 */
const DEFAULT_CROSS_ORIGIN_PORT = 4318;
/** 两个服务共同监听的回环地址。 */
const HOST = '127.0.0.1';
/** 用于校验端口取值的最大端口号。 */
const MAX_PORT = 65_535;

/**
 * 读取有效的监听端口；无效取值回退到默认端口。
 * @param {string} environmentKey 环境变量名。
 * @param {number} defaultPort 回退使用的默认端口。
 * @returns {number} 可供监听的端口。
 */
function getPort(environmentKey, defaultPort) {
  /** 从环境变量读取的候选端口。 */
  const configuredPort = Number(process.env[environmentKey]);
  return Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= MAX_PORT
    ? configuredPort
    : defaultPort;
}

/** 主站点监听端口。 */
const port = getPort('PORT', DEFAULT_PORT);
/** 跨域验证服务监听端口。 */
const crossOriginPort = getPort('CROSS_ORIGIN_PORT', DEFAULT_CROSS_ORIGIN_PORT);
/** 跨域验证服务的基地址，会通过 /api/config 告知页面。 */
const crossOriginBaseUrl = `http://${HOST}:${crossOriginPort}`;

/** 主站点路由表。 */
const labRoutes = createLabRoutes({ crossOriginBaseUrl });
/** 跨域验证服务路由表。 */
const crossOriginRoutes = createCrossOriginRoutes();

/** 主站点：动态端点 + 静态资源兜底。 */
const labServer = createServer(
  createRequestHandler({ routes: labRoutes, fallback: serveStatic }),
);
/** 跨域验证服务：只有跨域端点，不提供静态资源。 */
const crossOriginServer = createServer(createRequestHandler({ routes: crossOriginRoutes }));

labServer.listen(port, HOST, () => {
  console.log(`\n  Req Freedom Request Lab\n  http://${HOST}:${port}`);
  console.log('\n  动态端点：');
  for (const route of labRoutes) {
    console.log(`    ${route.method.padEnd(5)} ${route.path.padEnd(20)} ${route.description}`);
  }
});

crossOriginServer.listen(crossOriginPort, HOST, () => {
  console.log(`\n  跨域验证服务（不同源）\n  ${crossOriginBaseUrl}`);
  for (const route of crossOriginRoutes) {
    console.log(`    ${route.method.padEnd(5)} ${route.path.padEnd(28)} ${route.description}`);
  }
  console.log('');
});
