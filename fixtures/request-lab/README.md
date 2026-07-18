# Req Freedom Request Lab

Req Freedom 的本地请求功能验证页，提供可被规则命中的静态 API、图片和脚本资源。

## 启动

从仓库根目录运行：

```bash
# 插件开发模式与 Request Lab 一起启动
mise exec -- pnpm dev

# 只启动 Request Lab
mise exec -- pnpm dev:lab
```

默认地址为 [http://127.0.0.1:4317](http://127.0.0.1:4317)。可通过 `PORT=4318 mise exec -- pnpm dev:lab` 使用其他端口。

## 覆盖范围

- Fetch / XHR 的返回值 Mock
- 请求拦截、重定向、参数注入与 Header 改写
- 网络延迟与上传带宽模拟（弱网资源响应体约 512 KB）
- JavaScript / CSS 注入的页面级验证
