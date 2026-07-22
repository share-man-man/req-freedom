import { defineConfig } from 'rspress/config';

// Rspress 文档站配置
export default defineConfig({
  // 文档源码目录
  root: 'docs',
  // GitHub Pages 项目站点部署在仓库同名子路径下
  base: '/req-freedom/',
  title: 'Req Freedom',
  description: '浏览器请求调试插件：拦截、重定向、参数注入、Header 改写、Mock、延迟模拟',
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/share-man-man/req-freedom',
      },
    ],
    lastUpdated: false,
  },
})
