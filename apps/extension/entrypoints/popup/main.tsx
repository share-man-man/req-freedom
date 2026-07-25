import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@/utils/i18n';
import App from './App';
import './style.css';

// 先完成 i18next 初始化（读取持久化语言 + 装载资源），再挂载 popup 根组件
initI18n().then((i18n) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </React.StrictMode>,
  );
});
