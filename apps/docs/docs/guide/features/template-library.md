# 常用规则模板库

把「本地联调第一高频」的几类需求沉淀成开箱即用的一键预设，省去从零配规则。

## 打开方式

在分组卡片的 **「添加规则」** 下拉里选 **从模板库…**；还没有任何规则时，空状态的 **「新建规则」** 下拉里也有同一入口。

选用某个模板后**不会**直接落库，而是打开规则编辑器并预填好动作；你只需把「匹配内容」改成自己的目标地址即可保存。从某个分组的下拉进入时，规则默认落到**该分组**；从空状态进入时会自动归入「默认分组」。

## 内置模板

| 模板 | 归类 | 执行通道 | 作用 |
| --- | --- | --- | --- |
| 解除 CORS 跨域限制 | 跨域 CORS | DNR | 为响应补上 `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Methods`、`Access-Control-Allow-Headers: *` |
| 禁用缓存 | 缓存控制 | DNR | 为请求与响应补上不缓存的 `Cache-Control` / `Pragma` |
| 强制 HTTPS | 协议与重定向 | DNR | 按正则把 `http://` 请求重定向到同地址的 `https://` |
| 移动端 UA · iPhone | User-Agent | DNR | 把 `User-Agent` 改成 iOS Safari |
| 移动端 UA · Android | User-Agent | DNR | 把 `User-Agent` 改成 Android Chrome |

## 说明

- 模板本质是 [Header 改写](./modify-headers.md) 与 [重定向](./redirect.md) 的语法糖，全部走 DNR 通道，对全部请求（含页面导航、静态资源）生效。
- **解除 CORS**：DNR 拿不到请求的 `Origin`，无法回显，因此用通配 `*`；与 `*` 搭配的凭据模式（`Access-Control-Allow-Credentials`）会被浏览器拒绝，模板未设置该头，覆盖最常见的无凭据跨域场景。
- 涉及具体接口 / 站点的模板（解除 CORS、禁用缓存、UA 切换）默认填示例域名占位，**请改成自己的目标地址**再保存，避免一键就对全站生效造成误伤。
- **强制 HTTPS** 按协议前缀命中，天然适合全量匹配，默认命中全部 `http://` 请求。
