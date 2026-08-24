# 配置文件协议

ReqFreedom 配置文件使用带版本号的 JSON 协议。人或 AI 生成配置时，应以本页的字段、枚举和语义约束为准；插件导入器会在写入本地配置前再次执行完整校验。

## 协议资源

- [最小 Mock 示例](https://share-man-man.github.io/req-freedom/examples/configuration-v3.mock.json)
- [覆盖全部动作的完整示例](https://share-man-man.github.io/req-freedom/examples/configuration-v3.complete.json)
- [v2 兼容示例](https://share-man-man.github.io/req-freedom/examples/configuration-v2.mock.json)

当前导出协议版本为 `schemaVersion: 3`。v3 增加 SSE 手动单步发送配置；导入器继续接受 v2，并把缺少发送方式的 SSE 规则迁移为自动发送。未来协议结构变化时会继续递增版本号，不会原地改变旧版本字段的语义。

## 顶层结构

```json
{
  "schemaVersion": 3,
  "exportedAt": "2026-08-19T08:00:00.000Z",
  "enabled": true,
  "groups": []
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 当前导出为数字 `3`；导入兼容 `2` |
| `exportedAt` | 是 | ISO 8601 日期时间 |
| `enabled` | 是 | 全局规则开关 |
| `groups` | 是 | 按展示和匹配顺序排列的规则分组 |

导入配置会整体替换插件中的现有分组和全局开关。配置文件不应包含密码、令牌或其他不希望随文件共享的敏感值。

## 分组

```json
{
  "id": "group-api-mocks",
  "name": "API Mock",
  "enabled": true,
  "updatedAt": "2026-08-19T08:00:00.000Z",
  "rules": []
}
```

分组 `id` 必须非空且在整个文件中唯一。`updatedAt` 使用 ISO 8601 日期时间。分组关闭后，其内部规则全部不生效。

## 规则公共字段

```json
{
  "id": "rule-user-profile",
  "name": "用户资料",
  "enabled": true,
  "channel": "page-patch",
  "methods": ["GET"],
  "matchType": "equals",
  "pattern": "https://api.example.com/v1/profile",
  "actions": []
}
```

| 字段 | 可选值或含义 |
| --- | --- |
| `id` | 非空字符串；在全部分组的全部规则中唯一 |
| `name` | 展示名称 |
| `enabled` | 规则开关 |
| `channel` | `dnr` 或 `page-patch` |
| `methods` | `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`；空数组表示全部方法 |
| `matchType` | `contains`、`equals`、`wildcard`、`regex` |
| `pattern` | 与 `matchType` 对应的 URL 匹配内容；`regex` 使用 JavaScript 正则语法 |
| `bodyMatch` | 可选，仅允许用于 `page-patch` |
| `scope` | 可选，限制规则生效的标签页、窗口或标签组 |
| `actions` | 至少一个与执行通道兼容的动作，按数组顺序执行 |

规则最终生效需要全局开关、所属分组开关和规则开关同时为 `true`。

## 执行通道与动作

| 动作 `type` | `channel` | 关键字段 |
| --- | --- | --- |
| `block` | `dnr` | 无 |
| `redirect` | `dnr` | `redirectUrl` |
| `inject-params` | `dnr` | `params` 字符串键值对象 |
| `modify-headers` | `dnr` | `headers` 数组 |
| `mock-response` | `page-patch` | `mode`、`statusCode`、`body` |
| `delay` | `page-patch` | `throttlePreset`、延迟与上下行速率 |
| `insert-script` | `page-patch` | `codeType`、`timing`、`code` |
| `modify-request-body` | `page-patch` | `sourceMode`、`mode`、`content` |

`dnr` 规则中的 `block`、`redirect`、`inject-params` 互相排斥，一条规则最多只能包含其中一个；它们可以与 `modify-headers` 组合。

`modify-request-body` 不能用于包含 `GET` 或 `HEAD` 的规则。由于空 `methods` 表示全部方法，因此该动作也不能搭配空 `methods`。

### Header 修改

每个 `headers` 元素包含：

- `target`：`request` 或 `response`
- `operation`：`set`、`append` 或 `remove`
- `header`：Header 名称
- `value`：值；`remove` 时可以省略

### Mock 响应

`mode` 为 `static` 或 `dynamic`。动态模式必须提供非空的 `functionCode`。`passthrough: true` 表示基于真实响应改写，仅允许用于动态模式。

`delivery: "sse"` 表示按 Server-Sent Events 交付，此时：

- `mode` 必须为 `static`
- `statusCode` 必须为 `200`
- `passthrough` 不能为 `true`
- `sseEvents` 至少包含一个事件
- `sseEndBehavior` 可为 `close`、`keep-open` 或 `loop`
- `sseSendMode` 可为 `auto` 或 `manual`，缺省为 `auto`
- `manual` 模式不允许搭配 `sseEndBehavior: "loop"`

手动单步示例：

```json
{
  "type": "mock-response",
  "mode": "static",
  "delivery": "sse",
  "statusCode": 200,
  "body": "",
  "sseSendMode": "manual",
  "sseEndBehavior": "close",
  "sseEvents": [
    { "event": "message", "data": "{\"step\":1}" },
    { "event": "message", "data": "{\"step\":2}" }
  ]
}
```

静态响应的 `bodyType` 可为 `json`、`text`、`html`、`xml`、`javascript` 或 `css`。即使内容是 JSON，`body` 仍然是字符串，需要在外层 JSON 中转义。

### 延迟与限速

`throttlePreset` 可为 `fast-3g`、`slow-3g` 或 `custom`。`latencyMs`、`downloadKbps`、`uploadKbps` 都是非负数字；带宽为 `0` 表示不限制。

### 脚本与样式注入

`codeType` 为 `js` 或 `css`，`timing` 为 `document_start` 或 `document_end`。注入规则匹配顶层文档 URL，而不是单个子资源请求。

### 请求体改写

`sourceMode` 为 `static` 或 `dynamic`；动态模式必须提供非空的 `functionCode`。静态模式的 `mode` 为 `replace` 或 `merge-json`，`content` 始终使用字符串保存。

## 请求体条件

`bodyMatch` 只允许用于 `page-patch`：

```json
{
  "bodyMatch": {
    "type": "graphql-operation",
    "value": "GetOrders"
  }
}
```

`type` 可为：

- `contains`：请求体文本包含 `value`
- `regex`：请求体文本匹配 JavaScript 正则 `value`
- `graphql-operation`：JSON 请求体的 `operationName` 等于 `value`

## 作用域

缺省 `scope` 表示全部标签页。显式写法如下：

```json
{
  "scope": {
    "type": "tab",
    "targets": [{ "id": 123, "label": "本地调试页" }]
  }
}
```

`type` 可为 `all-tabs`、`tab`、`window` 或 `tab-group`。`all-tabs` 的 `targets` 必须为空；其余类型至少包含一个目标。目标 ID 属于浏览器会话，配置导入到其他浏览器或重启后可能失效，因此跨环境共享的配置通常应省略 `scope`。

## 动态变量

重定向地址、参数值、Header 值、Mock 内容和静态请求体内容可以使用：

- `{{uuid}}`
- `{{timestamp}}`、`{{timestampMs}}`、`{{isoTime}}`
- `{{randomInt(min,max)}}`、`{{randomFloat}}`
- `{{randomString(length)}}`
