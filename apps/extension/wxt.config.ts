import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT 配置：React 模块 + Tailwind v4 + MV3 manifest
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Tailwind v4 通过 Vite 插件接入，各 entrypoint 的 CSS 里 @import "tailwindcss" 即可
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => ({
    // 名称/描述走 _locales（浏览器按 UI 语言选取），default_locale 缺失时的兜底同时提供中文原文
    default_locale: 'zh_CN',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: [
      'storage',
      'activeTab',
      'declarativeNetRequest',
      // declarativeNetRequestFeedback 是调试权限：onRuleMatchedDebug 仅对未打包扩展生效，
      // 正式包改用 activeTab 调 getMatchedRules。保留在商店包里不生效却会触发上架校验告警，
      // 故只在开发构建注入。
      ...(mode === 'development' ? ['declarativeNetRequestFeedback'] : []),
      'tabGroups',
    ],
    host_permissions: ['<all_urls>'],
  }),
});
