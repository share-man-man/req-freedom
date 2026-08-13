# ReqFreedom

> 浏览器请求调试插件 —— 拦截、重定向、参数注入、Header 改写、返回值 Mock、网络限速、改请求体、脚本注入，一站式全链路能力。

📖 [在线文档](https://share-man-man.github.io/req-freedom/) · 🚀 [快速开始](https://share-man-man.github.io/req-freedom/guide/getting-started) · 🏗️ [架构设计](https://share-man-man.github.io/req-freedom/guide/architecture)

一条规则先选择**执行通道**（DNR 网络层 / 页面补丁），再按 URL、请求方法、请求体条件匹配请求，最后组合多个动作。规则按分组管理，支持导入导出、模板库、cURL / HAR 导入与命中日志排查。

## 功能

| 能力 | 通道 | 说明 |
| --- | --- | --- |
| [请求拦截](https://share-man-man.github.io/req-freedom/guide/features/block) | DNR | 按 URL 匹配直接阻断请求，验证降级与兜底逻辑 |
| [重定向](https://share-man-man.github.io/req-freedom/guide/features/redirect) | DNR | 把线上接口指向本地或测试环境，支持正则捕获组替换 |
| [参数注入](https://share-man-man.github.io/req-freedom/guide/features/inject-params) | DNR | 向命中请求的 URL 追加或覆盖查询参数 |
| [Header 改写](https://share-man-man.github.io/req-freedom/guide/features/modify-headers) | DNR | 请求头 / 响应头的设置、追加、移除，处理鉴权与 CORS 调试 |
| [返回值 Mock](https://share-man-man.github.io/req-freedom/guide/features/mock) | 页面补丁 | 返回静态响应体或 JavaScript 动态生成的响应，另支持 SSE 逐事件交付 |
| [网络限速](https://share-man-man.github.io/req-freedom/guide/features/delay) | 页面补丁 | 注入人为延迟与上下行带宽限制，验证 loading 态与超时处理 |
| [改请求体](https://share-man-man.github.io/req-freedom/guide/features/modify-request-body) | 页面补丁 | 请求发出前静态替换、JSON 深合并或动态生成请求体 |
| [脚本注入](https://share-man-man.github.io/req-freedom/guide/features/insert-script) | 页面补丁 | 按页面 URL 注入自定义 JS / CSS，可选 `document_start` / `document_end` 时机 |

配套能力：

- [作用域过滤](https://share-man-man.github.io/req-freedom/guide/features/scope-filter)：把规则限定到指定标签页 / 窗口 / 标签组，避免敏感 Header 误发到其他站点
- [请求体匹配](https://share-man-man.github.io/req-freedom/guide/features/request-body-match)：按请求体子串、正则或 GraphQL `operationName` 收敛命中范围
- [动态变量](https://share-man-man.github.io/req-freedom/guide/features/dynamic-variables)：取值字段中使用 `{{uuid}}`、`{{timestamp}}`、`{{randomInt(1,100)}}` 等占位符
- [请求日志](https://share-man-man.github.io/req-freedom/guide/features/request-log)：逐条查看时间、方法、URL、命中规则与执行结果
- [模板库](https://share-man-man.github.io/req-freedom/guide/features/template-library)：解除 CORS、禁用缓存、强制 HTTPS、移动端 UA 等一键预设
- [cURL / HAR 导入](https://share-man-man.github.io/req-freedom/guide/features/curl-har-import) 与[配置导入导出](https://share-man-man.github.io/req-freedom/guide/import-export)
- 界面支持 10 种语言与明暗主题

## 安装

从源码构建后以未打包扩展加载：

```bash
mise exec -- pnpm install
mise exec -- pnpm build
```

在 `chrome://extensions` 开启开发者模式，「加载已解压的扩展程序」并选择 `apps/extension/.output/chrome-mv3/`。

## 开发

环境要求：Node.js >= 22（版本由 `mise.toml` 锁定）、pnpm 9。

```bash
# 插件开发模式（自动打开带插件的 Chrome）
mise exec -- pnpm dev

# 文档站开发模式
mise exec -- pnpm dev:docs

# 类型检查 / 构建 / 单测 / 依赖检查
mise exec -- pnpm typecheck
mise exec -- pnpm build
mise exec -- pnpm test
mise exec -- pnpm knip
```

## 仓库结构

```text
req-freedom/
├── apps/
│   ├── extension/                       # 浏览器插件（WXT + React 19，MV3）
│   │   ├── entrypoints/
│   │   │   ├── background.ts            # 同步规则到 declarativeNetRequest、汇总命中日志
│   │   │   ├── bridge.content.ts        # ISOLATED world，读 storage 并推送规则
│   │   │   ├── interceptor.content.ts   # MAIN world，fetch / XHR 补丁与脚本注入
│   │   │   ├── popup/                   # 快速启停与本页命中概览
│   │   │   └── options/                 # 规则管理与请求日志
│   │   └── utils/                       # storage 封装、DNR 规则转换、页面执行计划
│   └── docs/                            # 文档站（Rspress）
└── packages/
    ├── shared/                          # 枚举、常量、类型定义
    └── core/                            # 平台无关的规则匹配引擎
```

技术栈：WXT（MV3）+ React 19 + TypeScript + Tailwind v4，文档站 Rspress，pnpm workspace monorepo。

## 双通道架构

```text
                     ┌──────────────────────────────┐
                     │   storage.local（规则存储）    │
                     └──────┬──────────────┬────────┘
                            │              │ storage.onChanged
                 onChanged  │              ▼
                            │      ┌────────────────────┐
                            ▼      │ bridge.content.ts  │ (ISOLATED)
                  ┌──────────────┐ └────────┬───────────┘
                  │ background   │          │ MessagePort
                  └──────┬───────┘          ▼
                         │         ┌──────────────────────┐
       updateDynamicRules│         │ interceptor.content  │ (MAIN)
                         ▼         │ fetch / XHR 补丁      │
              ┌────────────────┐   │ + 脚本 / 样式注入      │
              │ declarativeNet │   └──────────┬───────────┘
              │ Request (DNR)  │              │
              └──────┬─────────┘              ▼
                     │        返回值 Mock、网络限速、脚本注入、改请求体
                     ▼
        拦截、重定向、参数注入、Header 改写
```

- **DNR 通道**：在网络层由浏览器原生执行，性能好、覆盖所有请求与所有 frame（包括页面导航）
- **页面补丁通道**：承载 DNR 无法表达的能力，通过 MAIN world 改写页面 `fetch` 与 `XMLHttpRequest` 实现

两条通道共用 `packages/core` 中的同一套匹配器。

### 已知限制

- 页面补丁通道**只作用于顶层文档**，iframe 内由页面 JS 发起的请求不经过该通道；需要覆盖子框架时改用 DNR 通道
- 同步 XHR、不透明响应（no-cors）无法承载页面补丁处理，一律 fail-open 原样放行，并在命中日志中标为「匹配上但未应用」
- 页面加载极早期（规则尚未通过 MessagePort 送达时）发起的请求不会被处理
- SSE Mock 不作用于 XHR，请通过 `fetch` 或原生 `EventSource` 消费

完整说明见文档的[已知限制](https://share-man-man.github.io/req-freedom/guide/architecture#已知限制)章节。

## 隐私

插件不收集、不上传任何数据，所有规则与命中日志仅存于本地浏览器存储。详见[隐私政策](https://share-man-man.github.io/req-freedom/privacy)。

## License

[MIT](./LICENSE)
