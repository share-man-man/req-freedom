# 架构设计

## 仓库结构

```text
req-freedom/
├── apps/
│   ├── extension/          # 浏览器插件（WXT + React，MV3）
│   │   ├── entrypoints/
│   │   │   ├── background.ts            # 同步规则到 declarativeNetRequest
│   │   │   ├── bridge.content.ts        # ISOLATED world，读 storage 并推送规则
│   │   │   ├── interceptor.content.ts   # MAIN world，fetch/XHR 补丁（Mock、延迟）
│   │   │   ├── popup/                   # 快速启停界面
│   │   │   └── options/                 # 规则管理界面
│   │   └── utils/          # storage 封装、DNR 规则转换
│   └── docs/               # 文档站（Rspress）
└── packages/
    ├── shared/             # 枚举、常量、类型定义
    └── core/               # 平台无关的规则匹配引擎
```

## 双通道拦截架构

不同能力由两条链路分别承载：

```text
                     ┌──────────────────────────────┐
                     │   storage.local（规则存储）   │
                     └──────┬──────────────┬────────┘
                            │              │ storage.onChanged
                 onChanged  │              ▼
                            │      ┌────────────────────┐
                            ▼      │ bridge.content.ts  │ (ISOLATED)
                  ┌──────────────┐ └────────┬───────────┘
                  │ background   │          │ postMessage
                  └──────┬───────┘          ▼
                         │         ┌──────────────────────┐
        updateDynamicRules│        │ interceptor.content  │ (MAIN)
                         ▼         │ fetch / XHR 补丁      │
              ┌────────────────┐   │ + 脚本 / 样式注入     │
              │ declarativeNet │   └──────────┬───────────┘
              │ Request (DNR)  │              │
              └──────┬─────────┘              ▼
                     │           返回值 Mock、延迟模拟、脚本注入
                     ▼
        拦截、重定向、参数注入、Header 改写
```

- **DNR 通道**：拦截 / 重定向 / 参数注入 / Header 改写在网络层由浏览器原生执行，性能好、覆盖所有请求（包括页面导航）
- **页面补丁通道**：返回值 Mock 与延迟模拟无法由 DNR 表达，通过 MAIN world 内容脚本改写 `fetch` 与 `XMLHttpRequest` 实现，仅作用于页面脚本发起的请求；脚本注入亦复用该通道，按页面 URL 命中后注入自定义 JS / CSS

## 已知限制（后续迭代）

- 页面加载极早期（规则尚未通过 postMessage 送达时）发起的请求不会被 Mock / 延迟
- XHR Mock 暂未伪造 `getAllResponseHeaders`
