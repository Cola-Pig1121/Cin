/**
 * 前端插件入口。
 *
 * 新增前端插件三步：
 * 1. 在 `client/plugins/<name>/index.tsx` 写页面组件
 * 2. 在下面 import 并调 `registerFrontendPlugin`
 * 3. 路径必须以 `/plugin/` 开头
 *
 * 注意：这里注册的是**前端页面**，服务端钩子在
 * `server/src/plugins/index.ts` 注册。两边 manifest.name 相同即为同一个插件。
 */

import { registerFrontendPlugin } from './registry';

import helloPlugin from '../../plugins/hello';

export function registerFrontendPlugins(): void {
  registerFrontendPlugin(helloPlugin);
}

// 模块加载时自动注册：路由表在 import 本文件后就会读到已注册的页面。
// 不在 main.tsx 里显式调，是因为路由表 import 顺序更可靠 ——
// 避免「注册还没执行就渲染路由」导致插件页面丢失。
registerFrontendPlugins();
