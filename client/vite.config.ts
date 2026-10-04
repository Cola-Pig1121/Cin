import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const serverPort = Number(process.env.RIN_SERVER_PORT || "11499");
  const serverTarget = `http://127.0.0.1:${serverPort}`;
  const cacheDir = process.env.RIN_VITE_CACHE_DIR || "../.vite/client";
  
  return {
    cacheDir,
    resolve: {
      // 必须去重 react/react-dom。
      // packages/ui 经 tsconfig paths 以源码形式参与构建，其中的 react
      // 会被解析成独立副本，生产 bundle 因此出现多份 React（表现为
      // hooks 宿主变量名不统一）。两份 React 各有独立的 dispatcher，
      // 组件若由其中一份渲染、hooks 却取自另一份，dispatcher 即为 null，
      // 报 "Cannot read properties of null (reading 'useRef')"。
      // 仅在 /admin/writing、/admin/settings、/friends 等页复现，
      // 因为只有它们会渲染 @rin/ui 里带 hooks 的组件。
      dedupe: ["react", "react-dom"],
    },
    // Note: Client configuration is fetched from server at runtime
    // No environment variables are injected at build time
    build: {
      outDir: '../dist/client',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      // Only open visualizer in build mode
      visualizer({ open: !isDev })
    ],
    server: {
      proxy: {
        "/api": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/atom.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
      },
    },
  }
})
