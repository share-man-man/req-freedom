# 改请求体

在请求真正发出前改写它的请求体，常用于联调时微调接口参数、GraphQL variables，或根据请求内容动态生成上行数据。

## 实现方式

`declarativeNetRequest` 拿不到也改不了请求体，因此改请求体走**页面补丁通道**：MAIN world 内容脚本改写页面的 `fetch` 与 `XMLHttpRequest`，命中规则时在发送前替换请求体。

> 注意：仅对页面脚本发起的 fetch / XHR 生效；页面导航、静态资源加载拿不到请求体，不在作用范围内。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `sourceMode` | 内容来源：`static` 静态改写 / `dynamic` JavaScript 动态生成 |
| `mode` | 静态改写模式：`replace` 整体替换 / `merge-json` JSON 深合并 |
| `content` | 静态改写内容：`replace` 为新的请求体文本；`merge-json` 为要合并的 JSON 文本 |
| `functionCode` | 动态模式的完整 JavaScript 函数（如 `function modify(req){...}`），使用 `req` 并返回最终请求体 |

### 两种模式

- **整体替换（`replace`）**：用 `content` 整体替换原请求体，原内容被丢弃。适合完全掌控上行数据的场景。
- **JSON 深合并（`merge-json`）**：把 `content` 作为 JSON 补丁深合并进原请求体。对象递归合并、同名字段覆盖、数组整体替换；原请求体或补丁不是合法 JSON 时**不改写**，请求原样发出。

## JavaScript 动态生成

将「请求体内容」切换为「JavaScript 动态生成」后，编辑器填写的是**一个完整函数**（默认模板 `function modify(req) { ... }`），运行时会以请求快照 `req` 调用它。使用 `req` 读取请求快照并 `return` 最终请求体：返回字符串会直接发送，其他可 JSON 序列化的值会自动序列化；需要异步时把函数声明成 `async function`。

```js
function modify(req) {
  return {
    ...req.json,
    variables: {
      ...req.json?.variables,
      first: Number(req.query.first ?? 100),
    },
  };
}
```

`req` 提供 `url`、`method`、页面设置的 `headers`、`query`、原始 `body` 与可选的 `json` 解析结果。未返回值、执行异常或结果无法 JSON 序列化时，会保留原请求体，避免意外发送空请求。

> 安全边界：函数会在命中页面的 MAIN world 中执行，拥有与页面 JavaScript 相同的权限。请只运行可信代码。

## 示例

只改 GraphQL 请求里的分页参数，不动其余字段：

- 匹配模式：`example.com/graphql`
- 改写模式：JSON 深合并
- 改写内容：`{"variables": {"first": 100}}`

## 按 GraphQL 操作精确改写

GraphQL 的所有操作往往共用同一个 URL 和 method，仅靠 URL 匹配会命中该端点上的**全部**请求。若只想改写某一个 `operationName`，在规则的「命中条件」里加一条[请求体匹配](./request-body-match.md)：请求体条件设为 `GraphQL 操作名` 并填入目标操作名，即可把改请求体动作限定到该操作，其余操作原样发出。
