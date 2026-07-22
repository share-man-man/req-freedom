# AGENTS.md

## 项目概述

Req Freedom 是一个浏览器请求调试插件。项目采用 pnpm workspace monorepo，主要技术栈为 Node.js 22、TypeScript、WXT（Manifest V3）、React 19 和 Rspress。

## 仓库结构

- `apps/extension/`：浏览器插件的界面与运行时代码
- `apps/docs/`：Rspress 文档站
- `packages/shared/`：共享枚举、常量和 TypeScript 类型
- `packages/core/`：与平台无关的规则匹配和转换逻辑
- `fixtures/`：本地测试夹具和请求实验环境相关资源

与平台无关的逻辑应放在 `packages/core` 中。共享协议和类型应定义在 `packages/shared` 中，不要在各应用内重复定义。

## 环境与包管理

- 使用 `mise.toml` 锁定的版本：Node.js 22.21.1、pnpm 9.15.9。
- 仅使用 pnpm，不要生成 npm 或 Yarn 的锁文件。
- 环境中存在 mise 时，通过 `mise exec --` 执行命令。
- 内部包依赖保持使用 `workspace:*` 协议。
- 不要编辑 `node_modules/`、`.output/` 或文档构建产物等生成内容。

## 常用命令

```bash
mise exec -- pnpm install
mise exec -- pnpm dev
mise exec -- pnpm dev:extension
mise exec -- pnpm dev:lab
mise exec -- pnpm dev:docs
mise exec -- pnpm typecheck
mise exec -- pnpm build
mise exec -- pnpm knip
```

当改动仅涉及单个 workspace 时，开发过程中优先运行范围更小的命令，例如：

```bash
mise exec -- pnpm --filter @req-freedom/extension typecheck
mise exec -- pnpm --filter @req-freedom/extension build
mise exec -- pnpm --filter @req-freedom/docs build
```

## 架构约束

规则通过以下两种通道之一执行：

- **DNR 通道**：请求拦截、重定向、查询参数和 Header 改写通过 `declarativeNetRequest` 在网络层执行。
- **页面补丁通道**：静态或 JavaScript Mock、延迟模拟、请求体修改和脚本注入通过 MAIN world 中对 `fetch` 与 `XMLHttpRequest` 的补丁实现。

必须保持这两种通道的职责边界。浏览器 DNR API 能够实现的功能应优先使用 DNR；仅在网络层 API 无法实现时使用页面补丁。

修改规则协议时：

1. 更新 `packages/shared` 中的标准类型和常量。
2. 更新 `packages/core` 中的匹配或转换逻辑。
3. 根据需要同步更新插件调用方以及持久化或迁移逻辑。
4. 行为或配置发生变化时，更新面向用户的文档。

`packages/core` 中的代码必须保持与浏览器插件全局变量及 React 无关。

## 编码规范

- 遵循相邻文件中已有的 TypeScript、ESM、React 和命名风格。
- 在包边界和浏览器执行上下文边界使用明确的类型。
- 保持模块职责单一；可复用的规则逻辑应提取出来，不要直接嵌入 UI 组件。
- 将内容脚本、后台 Service Worker 和 MAIN world 脚本视为不同的执行上下文；跨上下文通信使用类型明确的消息和可序列化数据。
- 插件运行时代码中避免使用仅限 Node.js 的 API。
- 遵守 MV3 的限制，包括 Service Worker 暂停机制和插件 CSP。
- UI 改动应与现有组件和样式保持一致；添加新依赖前优先复用已有基础组件。
- 只为浏览器限制、跨上下文行为或不明显的兼容性处理添加注释，不要解释显而易见的代码。

## 验证要求

完成改动前：

1. 对所有受影响的 workspace 运行类型检查。
2. 运行覆盖改动范围的最小构建命令。
3. 跨包或影响发布的改动需要运行根目录的 `pnpm typecheck` 和 `pnpm build`。
4. 添加、删除或移动导出及依赖时，运行 `pnpm knip`。
5. 修改插件运行时后，在 `apps/extension/.output/chrome-mv3/` 的未打包插件中手动验证相关流程。

当前根目录没有测试脚本。除非存在并实际运行了相关测试命令，否则不要声称自动化测试已经通过。

## 改动原则

- 改动范围应聚焦于用户要求的行为。
- 不要改写无关代码或生成文件。
- 用户可见功能、规则语义、安装方式或架构决策发生变化时，同步更新文档。
- 最终交付时列出改动文件和实际执行的验证命令，并说明未能完成的检查。
