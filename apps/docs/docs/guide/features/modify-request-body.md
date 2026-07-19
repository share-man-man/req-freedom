# 改请求体

在请求真正发出前改写它的请求体，常用于联调时微调接口参数、GraphQL variables，或整体替换上行数据。

## 实现方式

`declarativeNetRequest` 拿不到也改不了请求体，因此改请求体走**页面补丁通道**：MAIN world 内容脚本改写页面的 `fetch` 与 `XMLHttpRequest`，命中规则时在发送前替换请求体。

> 注意：仅对页面脚本发起的 fetch / XHR 生效；页面导航、静态资源加载拿不到请求体，不在作用范围内。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `mode` | 改写模式：`replace` 整体替换 / `merge-json` JSON 深合并 |
| `content` | 改写内容：`replace` 为新的请求体文本；`merge-json` 为要合并的 JSON 文本 |

### 两种模式

- **整体替换（`replace`）**：用 `content` 整体替换原请求体，原内容被丢弃。适合完全掌控上行数据的场景。
- **JSON 深合并（`merge-json`）**：把 `content` 作为 JSON 补丁深合并进原请求体。对象递归合并、同名字段覆盖、数组整体替换；原请求体或补丁不是合法 JSON 时**不改写**，请求原样发出。

## 示例

只改 GraphQL 请求里的分页参数，不动其余字段：

- 匹配模式：`example.com/graphql`
- 改写模式：JSON 深合并
- 改写内容：`{"variables": {"first": 100}}`

## GraphQL 匹配的局限

GraphQL 的所有操作往往共用同一个 URL 和 method，仅靠 URL 匹配会命中该端点上的**全部**请求，无法只针对某一个 `operationName`。若需按操作精确改写，需等待「请求体匹配」能力落地后配合使用。
