# 请求体匹配

在 URL 与请求方法之外，按**请求体内容**进一步收敛命中范围。最典型的场景是 GraphQL：所有操作往往共用同一个 URL 和 method，只能靠请求体里的 `operationName` 区分，光靠 URL 匹配一定会命中该端点上的全部请求。

## 实现方式

`declarativeNetRequest` 拿不到请求体，因此请求体匹配只对**页面补丁通道**的规则生效：MAIN world 内容脚本先按 URL + 方法初筛命中规则，若其中任一规则配置了请求体条件，则读取一次请求体后再按条件二次过滤。

> 注意：只作用于页面脚本发起的 `fetch` / `XMLHttpRequest`；页面导航、静态资源加载拿不到请求体，不在作用范围内。按页面 URL 命中的脚本注入也没有可匹配的请求体，因此不提供该条件。

未配置请求体条件的规则不受影响，也不会为它们额外读取请求体。

## 规则字段

请求体条件是规则的可选匹配条件（`bodyMatch`），与 URL、方法并列：

| 字段 | 说明 |
| --- | --- |
| `bodyMatch.type` | 匹配方式：`contains` 包含子串 / `regex` 正则 / `graphql-operation` GraphQL 操作名 |
| `bodyMatch.value` | 匹配值：`contains` 为子串、`regex` 为正则、`graphql-operation` 为 `operationName` |

三种匹配方式：

- **包含子串（`contains`）**：请求体文本包含 `value` 即命中。最通用，无需请求体是 JSON。
- **正则（`regex`）**：用 `value` 作为正则测试请求体文本；正则语法非法时视为不命中。
- **GraphQL 操作名（`graphql-operation`）**：把请求体解析为 JSON，取其中的 `operationName` 与 `value` 比较；支持批量请求（数组）中任一操作命中。请求体不是合法 JSON 或无 `operationName` 时不命中。

## 示例：只 Mock 某一个 GraphQL 操作

同一个 `POST /api/graphql` 端点上有 `ListItems` 与 `GetUser` 两个操作，只想拦截 `GetUser` 返回 Mock，`ListItems` 照常发往真实服务：

- 匹配方式：`包含` → `/api/graphql`
- 请求方法：`POST`
- 请求体条件：`GraphQL 操作名` → `GetUser`
- 动作：返回值 Mock

配置后只有 `GetUser` 请求被 Mock 拦截，`ListItems` 不受影响。改请求体、限速等页面补丁动作同样可以配合请求体条件，实现「同 URL 只改其中一个操作」。
