import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT 配置：React 模块 + Tailwind v4 + MV3 manifest
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Tailwind v4 通过 Vite 插件接入，各 entrypoint 的 CSS 里 @import "tailwindcss" 即可
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Req Freedom',
    description: '请求调试工具：拦截、重定向、参数注入、Header 改写、Mock、延迟模拟',
    permissions: ['storage', 'declarativeNetRequest'],
    host_permissions: ['<all_urls>'],
  },
});
