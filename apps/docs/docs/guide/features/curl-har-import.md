# 导入规则

规则管理页右上角的「更多」菜单中选择「导入规则」，会打开统一导入弹窗。通过顶部 Tab 可在 ReqFreedom 配置、cURL 和 HAR 三种导入方式之间切换。

## 导入 ReqFreedom 配置

ReqFreedom 配置支持将 `.json` 文件拖入上传区域、点击选择文件，或直接在编辑区粘贴 JSON。插件会先校验 JSON 与配置协议；确认导入后，将使用其中的全局开关、分组和规则替换当前全部配置。

需要在现有配置上新增规则而不是整体替换时，请改用 cURL 或 HAR 导入。

## 从 cURL 创建单条规则

切换到「cURL」Tab，粘贴浏览器开发者工具复制的 cURL 命令。插件会按「返回值 Mock」生成规则草稿；如需重定向等其他动作，可在随后打开的规则编辑器中切换。

插件会提取请求 URL、HTTP 方法，以及 GraphQL 请求中的 `operationName`。解析完成后进入原有单条规则编辑器，可继续修改所属分组、规则名称、Mock 响应或重定向目标。

cURL 只描述请求，不包含期望的 Mock 响应或重定向目标，因此生成的动作只是可编辑草稿。导入过程不会执行命令，也不支持管道、变量展开、配置文件或 `@file` 本地文件读取。

## 从 HAR 批量创建 Mock

切换到「HAR」Tab，可拖拽/点击上传 `.har` 文件，也可直接粘贴 HAR JSON。解析后，插件默认读取 Fetch / XHR 的文本响应，并生成静态 Mock：

- URL 与 HTTP 方法作为请求匹配条件
- HTTP 状态码、状态说明、响应头和响应体作为 Mock 响应
- JSON、HTML、XML、JavaScript、CSS 和纯文本响应自动识别内容类型
- GraphQL 请求按 `operationName` 进一步区分

批量预览顶部统一选择所属分组。每条候选规则可单独选择，并通过手风琴展开修改规则名称及完整配置。

相同 URL、方法与 GraphQL 操作的重复请求默认不选中，避免多条规则互相覆盖。二进制响应、超过单条大小限制的响应和非 Fetch / XHR 资源不会生成候选规则。

## 启用策略

为避免导入后立即接管页面请求：

- 新建导入分组默认整组停用
- 追加到已有分组时，新增规则默认单独停用

勾选「导入后立即启用」可改变该行为。批量保存会在所有选中规则通过校验后一次写入，不会留下只导入一部分的状态。

## XHR Mock 兼容

XHR Mock 会模拟常用响应能力，包括：

- `getResponseHeader()`
- `getAllResponseHeaders()`
- `status` / `statusText`
- `responseURL`
- 文本、JSON、Blob 与 ArrayBuffer `responseType`
- `HEADERS_RECEIVED`、`LOADING`、`DONE` 状态变化

`Set-Cookie` 和 `Set-Cookie2` 与浏览器真实 XHR 一样不会通过响应头读取 API 暴露。
