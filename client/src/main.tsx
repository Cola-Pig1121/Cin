import React from 'react'
import ReactDOM from 'react-dom/client'
import { configureModalAppElement } from '@rin/ui'
import 'remixicon/fonts/remixicon.css'
import App from './App'
import './index.css'
import './components.css'
import { GlobalErrorBoundary } from './components/error-boundary.tsx'
import { bootstrapApp } from './app/bootstrap'

bootstrapApp()

// 诊断：把模块级错误直接显示在页面上。
// 之前的问题是「空白页 + 控制台无报错」——因为错误发生在
// ErrorBoundary 生效之前（模块顶层求值阶段），React 根本没挂载，
// 任何错误处理都捕获不到。这里用原生 API 兜底。
const showFatalError = (label: string, error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[fatal:${label}]`, error);

  const root = document.getElementById('root');
  if (root && !root.childElementCount) {
    root.innerHTML = `<pre style="padding:1rem;color:#b91c1c;white-space:pre-wrap;font:12px/1.5 monospace">启动失败 (${label})\n\n${message}</pre>`;
  }
};

window.addEventListener('error', (e) => showFatalError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatalError('rejection', e.reason));

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </React.StrictMode>
  );
} catch (error) {
  showFatalError('render', error);
  throw error;
}
configureModalAppElement('#root');
