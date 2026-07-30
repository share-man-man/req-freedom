# Req Freedom Request Lab

Req Freedom 的本地请求功能验证页：既提供可被规则命中的静态资源，也提供一组动态接口，用来观测规则改写后**服务端实际收到了什么**。

## 启动

从仓库根目录运行：

```bash
# 插件开发模式与 Request Lab 一起启动
mise exec -- pnpm dev

# 只启动 Request Lab
mise exec -- pnpm dev:lab
```

会同时起两个服务：

| 服务 | 默认地址 | 用途 | 端口变量 |
| --- | --- | --- | --- |
| 主站点 | [http://127.0.0.1:4317](http://127.0.0.1:4317) | 验证页 + 静态资源 + 动态接口 | `PORT` |
| 跨域服务 | http://127.0.0.1:4318 | **不同源**，仅用于 CORS 验证 | `CROSS_ORIGIN_PORT` |

端口可分别覆盖，例如 `PORT=5317 CROSS_ORIGIN_PORT=5318 mise exec -- pnpm dev:lab`。页面通过 `/api/config` 向服务端询问跨域地址，因此改端口后跨域卡片仍会指向正确目标，无需改代码。

## 覆盖范围

- Fetch / XHR 的返回值 Mock
- 请求拦截、重定向、参数注入与 Header 改写
- 网络延迟与上传带宽模拟（弱网资源响应体约 512 KB）
- JavaScript / CSS 注入的页面级验证
- 改请求体（Fetch / XHR 两条路径，经 `/api/echo` 回显核对）
- 按请求方法、按 GraphQL `operationName` 的差异化命中
- Cookie 双向改写、任意状态码、跨域 / CORS
- 非法 DNR 规则的注册失败提示（规则被浏览器拒绝时界面如何表现）

## 示例配置

导入同目录的 `req-freedom-config.json` 后，所有可交互卡片均有一条已启用的对应规则：DNR 覆盖资源拦截、重定向、参数、Header、Cookie、CORS 与 DELETE 方法；页面补丁覆盖 Fetch / XHR Mock、状态码 Mock、上下行限速、改请求体与 GraphQL；页面脚本区会在刷新后显示注入结果。

示例配置里刻意留了一条**注册必定失败**的规则（`非法正则（浏览器会拒绝注册）`）：正则用了前瞻断言，JS 的 `RegExp` 认、DNR 的 RE2 引擎不认。它服务于「非法规则 / 注册失败」卡片，预期表现是——请求正常返回、该规则在 popup 与管理页被标为未被浏览器接受、且不计入命中。副作用是每轮规则同步都会走「整批提交失败 → 逐条注册隔离非法规则」的降级路径，这本身也是该卡片要验证的一环：其余规则照常生效。不需要时把这条规则停用即可。

示例配置默认面向 `http://127.0.0.1:4317`。若用 `PORT` 改了主站端口，导入后请把重定向目标和脚本注入规则中的端口一并改为实际端口。

用于验证 cURL / HAR 创建规则的夹具：

- `import-sample.curl.txt`：复制文件内容，选择「从 cURL 创建规则」，可验证 POST、JSON 请求体与 GraphQL `operationName` 提取。
- `import-sample.har`：选择「从 HAR 批量创建 Mock」导入，可验证 XHR 响应头、两个 GraphQL 操作，以及相同 URL + 方法的重复请求默认不选中。

## 结构

```
request-lab/
├── server.mjs              # 入口：读端口、建两个服务、打印路由表
├── server/
│   ├── router.mjs          # 路由表匹配与分发，未命中回落静态
│   ├── static.mjs          # 静态资源（含弱网资源扩容、路径穿越防护）
│   ├── http.mjs            # 响应与请求体读取的共用工具
│   └── routes/             # 动态端点，一个文件一个关注点
├── api/*.json              # 静态夹具数据（保持文件形式，好读好改）
├── assets/                 # 页面脚本与样式
└── index.html              # 验证页
```

零运行时依赖，只用 Node 内置模块。**新增动态端点** = 在 `server/routes/` 加一个文件 + 在 `routes/index.mjs` 注册一行，不需要动分发逻辑。

## 动态接口

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/api/config` | GET | 下发跨域服务地址等页面运行时配置 |
| `/api/echo` | 任意 | 回显方法 / 查询 / 请求头 / 请求体 |
| `/api/methods` | 任意 | 回显服务端实际处理的方法 |
| `/api/graphql` | POST | 按请求体里的 `operationName` 返回不同数据 |
| `/api/cookies` | GET | 回显 `Cookie` 请求头，并下发三条可见性各异的 `Set-Cookie` |
| `/api/status/{code}` | 任意 | 返回指定 HTTP 状态码 |

跨域服务（另一端口）：

| 端点 | 用途 |
| --- | --- |
| `/api/cross-origin/blocked` | **故意不发 CORS 头**，浏览器会拦下，需用响应头改写规则解除 |
| `/api/cross-origin/allowed` | 主动放行 CORS 的对照组，用来区分「跨域被拦」与「服务没起来」 |

### 几个刻意为之的设计

- **`/api/echo` 不限制方法且一律返回 200。** 夹具不该用 405 把请求挡在门外，否则「规则没命中」和「方法不被接受」会混在一起难以排查。无请求体的 GET / HEAD 回显空串，负载结构保持一致。
- **回显字段按重要性排序。** 页面日志会截断过长文本，`receivedBody` / `receivedJson` 排在体量大的 `headers` 之前，保证关键内容不被截掉。
- **静态部分仍只接受 GET / HEAD。** 需要动态行为的场景应注册成路由，而不是打到静态分支。
- **CORS 只能由 DNR 通道解除。** 浏览器在网络层就拦下了响应，页面补丁通道（MAIN world）根本看不到它。
