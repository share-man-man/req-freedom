import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT 配置：React 模块 + Tailwind v4 + MV3 manifest
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Tailwind v4 通过 Vite 插件接入，各 entrypoint 的 CSS 里 @import "tailwindcss" 即可
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: () => ({
    // 名称/描述走 _locales（浏览器按 UI 语言选取），无法匹配时回退到英文
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: [
      'storage',
      'activeTab',
      'declarativeNetRequest',
      'tabGroups',
      // 观测式 webRequest 是唯一可用的 DNR 命中推送信号，且不触发额外的安装警告；
      // webNavigation 会触发「读取您的浏览记录」，改用 main_frame 请求作为重置点后已移除。
      'webRequest',
    ],
    host_permissions: ['<all_urls>'],
  }),
});
