import { sendJson } from '../http.mjs';

/** 路径中未指定或指定了非法状态码时使用的兜底值。 */
const DEFAULT_STATUS_CODE = 200;
/** HTTP 状态码的合法下界。 */
const MIN_STATUS_CODE = 100;
/** HTTP 状态码的合法上界。 */
const MAX_STATUS_CODE = 599;

/**
 * 任意状态码端点：`/api/status/404`、`/api/status/500` 等按路径返回对应状态。
 *
 * 用于验证规则在各类响应状态下的表现（错误兜底、重试逻辑），
 * 也是后续 cURL / HAR 导入生成规则时的现成目标。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {void}
 */
export function handleStatus({ response, pathname }) {
  /** 路径最后一段声明的目标状态码。 */
  const requestedCode = Number(pathname.split('/').pop());
  /** 实际使用的状态码，非法输入回落到默认值。 */
  const statusCode =
    Number.isInteger(requestedCode) &&
    requestedCode >= MIN_STATUS_CODE &&
    requestedCode <= MAX_STATUS_CODE
      ? requestedCode
      : DEFAULT_STATUS_CODE;
  sendJson(response, statusCode, {
    statusCode,
    message: `服务端按请求返回了 HTTP ${statusCode}`,
  });
}
