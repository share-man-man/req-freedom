# 脚本注入

按页面 URL 命中后，向页面注入自定义 JavaScript 或 CSS，用于临时改样式、打日志、注入调试工具，无需改动源码或起本地服务。

## 实现方式

走**页面补丁通道**：MAIN world 内容脚本在页面上下文创建 `<script>`（JS）或 `<style>`（CSS）元素完成注入。

- 匹配的是**顶层文档的 URL**（`window.location.href`），而非单个请求 URL。
- 每条规则在一次页面加载内只注入一次；修改规则后需**刷新页面**才会重新注入（已执行的 JS 无法撤销）。

> 注意：注入的 `<script>` 会受页面自身 CSP（`script-src`）约束，个别强 CSP 站点可能拦截内联脚本；CSS 注入不受此限。

## 规则字段

| 字段 | 说明 |
| --- | --- |
| `codeType` | 注入类型：`js`（JavaScript）/ `css`（CSS） |
| `timing` | 注入时机：`document_start`（文档开始解析，早于页面脚本）/ `document_end`（DOM 就绪后） |
| `code` | 注入的代码内容 |

### 注入时机怎么选

- `document_start`：想在页面自身脚本执行**之前**抢先注入（如提前挂钩全局对象、改写全局变量）时用。此时 DOM 尚未构建完成。
- `document_end`：需要操作 DOM 元素（如查找节点、改样式、插入按钮）时用，等 `DOMContentLoaded` 后再执行更稳。

## 示例

给某站点整站置灰：

- 匹配方式：`contains`
- 匹配模式：`example.com`
- 代码类型：`css`
- 注入时机：`document_end`
- 代码：`body { filter: grayscale(1); }`

页面加载即打印一行日志：

- 代码类型：`js`
- 注入时机：`document_start`
- 代码：`console.log('injected by req-freedom');`
