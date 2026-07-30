# 返回值 Mock

拦截命中的请求并直接返回自定义响应，不发起真实网络请求。除固定响应体外，也可以用 JavaScript 根据请求内容动态生成响应，或者[基于真实响应改写](#基于真实响应改写)——保留后端返回的其余内容，只改其中一部分。

## 实现方式

`declarativeNetRequest` 无法构造响应体，因此 Mock 走**页面补丁通道**：MAIN world 内容脚本改写页面的 `fetch` 与 `XMLHttpRequest`，命中规则时直接构造响应返回。

> 注意：仅对**顶层文档**中页面脚本发起的 fetch / XHR 生效；iframe 内部的请求、页面导航与静态资源加载都不在 Mock 范围内。同步 XHR（`open(..., false)`）会原样放行，规则不生效，详见[已知限制](../architecture.md#已知限制)。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `statusCode` | 响应状态码 |
| `mode` | `static` 为静态响应体；`dynamic` 为 JavaScript 动态生成 |
| `body` | 静态模式的响应体字符串（JSON 请自行序列化） |
| `functionCode` | 动态模式的 JavaScript 函数体，使用 `req` 并返回响应体 |
| `passthrough` | 是否先发出真实请求、再由函数改写响应体，可选；仅动态模式可用 |
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

## 基于真实响应改写

默认的 Mock 是**短路**的：请求不会发到服务端，响应完全由规则构造。适合后端还没写完、要模拟错误码、或者接口有副作用不能真调的场景。

但有时后端返回的数据基本是对的，你只想改其中一个字段。这时在动态模式下打开**「基于真实响应」**开关，Mock 就切换为**包装**语义：

1. 先照常发出真实请求（若同一条规则还配了「改请求体」，会先应用改写再发出）
2. 拿到真实响应后，连同 `res` 快照一起交给你的函数
3. 用函数的返回值替换响应体，**状态码与响应头一律沿用真实响应**

```js
function mock(req, res) {
  // 只把列表里每一项的 status 改掉，其余字段保持后端返回的原样
  return {
    ...res.json,
    list: (res.json?.list ?? []).map((item) => ({ ...item, status: 'active' })),
  };
}
```

`res` 是真实响应的快照：

| 字段 | 说明 |
| --- | --- |
| `url` | 真实响应的最终 URL（重定向后的地址） |
| `status` | HTTP 状态码；网络失败时为 `0` |
| `statusText` | HTTP 状态说明 |
| `ok` | 状态码是否落在 2xx |
| `headers` | 真实响应头，键为小写 Header 名 |
| `body` | 响应体原始文本 |
| `json` | 响应体是合法 JSON 时的解析结果；否则不存在 |

几个要点：

- **不返回值表示不改写**。函数 `return` 了 `undefined` 时保留真实响应体，与「改请求体」的动态模式语义一致。
- **函数抛异常时同样保留真实响应体**，只在页面控制台输出错误——避免一处笔误就把页面数据打空。
- **开关只在动态模式下可用**。静态模式发一次真实请求再把结果整体丢弃没有意义，因此编辑器不显示该开关，导入配置时也会直接判为不合法。
- **状态码输入框会隐藏**。既然状态码来自服务端，规则里再填一个只会误导；需要自定义状态码，说明你要的本来就是短路 Mock。
- **不透明响应（`no-cors`）原样放行**。这类响应读不到 body 也无法重建，函数不会被调用。

> 实现说明：XHR 侧无法「放行后再改」——原生的 `load` / `readystatechange` 是同步派发的，会抢在异步函数返回前把响应交给页面代码。因此页面持有的那个 XHR 全程不会真正 `send`，真实请求由一个内部的影子实例承载，等函数返回后才把外层伪造成完成态。这是 Requestly、xhook 等工具共同采用的做法。
