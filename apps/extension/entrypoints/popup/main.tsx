import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

// 挂载 popup 根组件
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
