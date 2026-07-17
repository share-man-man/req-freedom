# Header 改写

对命中请求的请求头 / 响应头进行设置、追加、移除。

## 实现方式

通过 `declarativeNetRequest` 的 `modifyHeaders` 动作实现，每条规则可包含多个修改项。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `headers[].target` | 作用目标：`request`（请求头）/ `response`（响应头） |
| `headers[].operation` | 操作：`set`（覆盖）/ `append`（追加）/ `remove`（移除） |
| `headers[].header` | Header 名称 |
| `headers[].value` | Header 值（`remove` 时可省略） |

## 示例

调试 CORS——给响应头补充跨域许可：

- 目标：`response`，操作：`set`
- Header：`Access-Control-Allow-Origin`，值：`*`
