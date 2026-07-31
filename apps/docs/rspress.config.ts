import path from 'node:path';
import { defineConfig } from 'rspress/config';

// Rspress 文档站配置
export default defineConfig({
  // 文档源码目录
  root: 'docs',
  // 全局样式：把主题色对齐插件规则配置页的设计令牌
  globalStyles: path.join(__dirname, 'styles/index.css'),
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
