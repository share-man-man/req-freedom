# Req Freedom

浏览器请求调试插件。规则先选择 DNR 网络层或页面补丁通道，再按请求方法组合拦截、重定向、参数、Header、静态 / 动态 Mock、限速、改请求体与脚本注入等动作。

📖 [在线文档](https://share-man-man.github.io/req-freedom/)

## 技术栈

- **插件**：[WXT](https://wxt.dev/)（MV3）+ React 19 + TypeScript
- **文档站**：[Rspress](https://rspress.dev/)
- **工程**：pnpm workspace monorepo，Node 版本由 `mise.toml` 锁定

## 仓库结构

```text
req-freedom/
├── apps/
│   ├── extension/   # 浏览器插件本体
│   └── docs/        # 文档站
└── packages/
    ├── shared/      # 枚举、常量、类型定义
    └── core/        # 平台无关的规则匹配引擎
```

## 快速开始

```bash
# 安装依赖
mise exec -- pnpm install

# 插件开发模式（自动打开带插件的 Chrome）
mise exec -- pnpm dev

# 文档站开发模式
mise exec -- pnpm dev:docs

# 构建全部
mise exec -- pnpm build

# 类型检查
mise exec -- pnpm typecheck
```

插件构建产物位于 `apps/extension/.output/chrome-mv3/`，可在 `chrome://extensions` 中「加载已解压的扩展程序」。

## 架构速览

- **DNR 通道**：拦截 / 重定向 / 参数注入 / Header 改写由 `declarativeNetRequest` 在网络层原生执行
- **页面补丁通道**：静态 / JavaScript 动态返回值 Mock、延迟模拟由 MAIN world 内容脚本改写页面 `fetch` 与 `XMLHttpRequest` 实现；脚本注入亦由该通道向页面注入自定义 JS / CSS

详细设计见在线文档的「[架构设计](https://share-man-man.github.io/req-freedom/guide/architecture)」章节。
