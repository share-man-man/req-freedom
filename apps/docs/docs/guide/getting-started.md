# 快速开始

## 环境要求

- Node.js >= 22（推荐使用 [mise](https://mise.jdx.dev/) 管理，仓库已提供 `mise.toml`）
- pnpm 9

## 安装依赖

```bash
mise exec -- pnpm install
```

## 本地开发

```bash
# 启动插件开发模式（自动打开带插件的 Chrome）
mise exec -- pnpm dev

# 启动文档站
mise exec -- pnpm dev:docs
```

## 构建

```bash
# 构建全部（插件 + 文档站）
mise exec -- pnpm build
```

插件产物位于 `apps/extension/.output/chrome-mv3/`，可在 `chrome://extensions` 开启开发者模式后「加载已解压的扩展程序」。

## 创建第一条规则

1. 点击浏览器工具栏中的插件图标，打开 popup
2. 点击「管理规则」进入规则管理页
3. 点击「+ 返回值 Mock」创建示例规则，按需修改匹配模式后勾选启用

## 查看规则命中

规则命中后，扩展图标徽标会立即显示当前标签页按业务规则聚合后的累计命中次数；打开 popup 时会显示相同数字。同一规则中的多个动作只计一次。已命中的规则会高亮显示；点击规则后的跳转按钮，可进入规则管理页并自动定位、高亮对应规则。「清空」按钮会同时重置当前标签页的命中次数、高亮状态和徽标。
