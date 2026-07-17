# 返回值 Mock

拦截命中的请求并直接返回自定义响应，不发起真实网络请求。

## 实现方式

`declarativeNetRequest` 无法构造响应体，因此 Mock 走**页面补丁通道**：MAIN world 内容脚本改写页面的 `fetch` 与 `XMLHttpRequest`，命中规则时直接构造响应返回。

> 注意：仅对页面脚本发起的 fetch / XHR 生效；页面导航、静态资源加载不在 Mock 范围内。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `statusCode` | 响应状态码 |
| `body` | 响应体字符串（JSON 请自行序列化） |
| `responseHeaders` | 附加响应头，默认 `Content-Type: application/json` |
| `delayMs` | 返回前的额外延迟（毫秒），可选 |

## 示例

模拟接口报错：

- 匹配模式：`example.com/api/user`
- 状态码：`500`
- 响应体：`{"code": 10500, "message": "internal error"}`
