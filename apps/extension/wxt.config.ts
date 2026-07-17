import { defineConfig } from 'wxt';

// WXT 配置：React 模块 + MV3 manifest
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Req Freedom',
    description: '请求调试工具：拦截、重定向、参数注入、Header 改写、Mock、延迟模拟',
    permissions: ['storage', 'declarativeNetRequest'],
    host_permissions: ['<all_urls>'],
  },
});
