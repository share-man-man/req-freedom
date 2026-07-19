import { readJsonBody, sendJson } from '../http.mjs';

/**
 * 各 GraphQL 操作对应的固定响应数据。
 *
 * 键即 `operationName`：所有操作共用同一个 URL 和方法，只能靠请求体里的这个字段区分——
 * 这正是「请求体匹配」与「改请求体」要解决的场景，因此夹具必须把它如实反映到响应里。
 */
const OPERATION_RESULTS = {
  ListItems: { items: [{ id: 1, name: '条目一' }, { id: 2, name: '条目二' }] },
  GetUser: { user: { id: 7, name: '张三', role: 'admin' } },
};

/**
 * GraphQL 式端点：按请求体中的 operationName 返回不同数据。
 *
 * 响应里同时回显服务端实际收到的 `operationName` 与 `variables`，
 * 因此改请求体规则是否把某个操作或某个变量改掉了，一眼可辨。
 * @param {import('../router.mjs').RequestContext} context 当前请求上下文。
 * @returns {Promise<void>} 响应结束后完成。
 */
export async function handleGraphql({ request, response }) {
  /** 服务端收到的请求体。 */
  const body = await readJsonBody(request);
  if (body.json === undefined) {
    sendJson(response, 400, {
      errors: [{ message: 'request body is not valid JSON' }],
      receivedBody: body.text,
    });
    return;
  }

  /** 请求声明的操作名。 */
  const operationName = body.json.operationName ?? null;
  /** 请求携带的变量。 */
  const variables = body.json.variables ?? null;
  /** 该操作对应的数据；未登记的操作按 GraphQL 惯例回 errors。 */
  const result = operationName === null ? undefined : OPERATION_RESULTS[operationName];

  if (result === undefined) {
    sendJson(response, 200, {
      errors: [{ message: `unknown operation: ${String(operationName)}` }],
      receivedOperationName: operationName,
      receivedVariables: variables,
      knownOperations: Object.keys(OPERATION_RESULTS),
    });
    return;
  }

  sendJson(response, 200, {
    data: result,
    receivedOperationName: operationName,
    receivedVariables: variables,
  });
}
