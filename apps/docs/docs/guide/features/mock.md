# 返回值 Mock

拦截命中的请求并直接返回自定义响应，不发起真实网络请求。除固定响应体外，也可以用 JavaScript 根据请求内容动态生成响应。

## 实现方式

`declarativeNetRequest` 无法构造响应体，因此 Mock 走**页面补丁通道**：MAIN world 内容脚本改写页面的 `fetch` 与 `XMLHttpRequest`，命中规则时直接构造响应返回。

> 注意：仅对页面脚本发起的 fetch / XHR 生效；页面导航、静态资源加载不在 Mock 范围内。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `statusCode` | 响应状态码 |
| `mode` | `static` 为静态响应体；`dynamic` 为 JavaScript 动态生成 |
| `body` | 静态模式的响应体字符串（JSON 请自行序列化） |
| `functionCode` | 动态模式的 JavaScript 函数体，使用 `req` 并返回响应体 |
| `responseHeaders` | 附加响应头，默认 `Content-Type: application/json` |
| `delayMs` | 返回前的额外延迟（毫秒），可选 |

## 示例

模拟接口报错：

- 匹配模式：`example.com/api/user`
- 状态码：`500`
- 响应体：`{"code": 10500, "message": "internal error"}`

## 动态生成响应

「响应内容」会把生成方式与编辑器放在同一项中。切换为「JavaScript 动态生成」后，编辑器填写的是**一个完整函数**（默认模板 `function mock(req) { ... }`），运行时会以请求快照 `req` 调用它。使用 `req` 读取请求信息并 `return` 响应值：返回字符串会原样作为响应体，其他可 JSON 序列化的值会自动序列化；需要异步时把函数声明成 `async function`。

```js
function mock(req) {
  const page = Number(req.query.page ?? 1);
  const payload = req.json ?? {};

  return {
    code: 0,
    data: {
      page,
      method: req.method,
      requestedIds: payload.ids ?? [],
    },
  };
}
```

`req` 是请求发出前的快照：

| 字段 | 说明 |
| --- | --- |
| `url` | 请求的绝对 URL |
| `method` | 大写 HTTP 方法 |
| `headers` | 页面代码通过 fetch/XHR 配置的请求头 |
| `query` | 查询参数对象；同名参数保留最后一个值 |
| `body` | 请求体原始文本；无法读取时为空字符串 |
| `json` | 请求体是合法 JSON 时的解析结果；否则不存在 |

> 安全边界：动态函数会在命中页面的 MAIN world 中执行，拥有与页面 JavaScript 相同的权限，能够访问页面 DOM、Cookie 可见部分和页面全局变量。请只粘贴自己完全信任的代码；不要把来自不可信配置文件或聊天记录的代码直接启用。

动态函数抛出异常时，Req Freedom 会在页面控制台输出错误，并返回一个包含错误信息的 JSON 响应体，方便调试。
