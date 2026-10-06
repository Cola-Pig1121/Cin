/**
 * 插件入口。
 *
 * 新增插件只需三步：
 * 1. 在 `server/plugins/<name>/index.ts` 写插件，default export 一个 RinPlugin
 * 2. 在下面 import 它，并加进 `ALL_PLUGINS` 数组
 * 3. 在后台「服务器配置」里加 `plugins.<name>.enabled` 控制启停
 *
 * 数组顺序 = 钩子执行顺序。`beforeCreate` 按顺序跑，
 * 任一插件返回拒绝文案就短路；`afterCreate` 全部都会跑完。
 */

import type { RinPlugin } from './types';
import { pluginRegistry } from './registry';

import commentGuard from '../../plugins/comment-guard';
import photoAlbum from '../../plugins/photo-album';

/**
 * 全部内置插件。
 *
 * 顺序有意义：靠前的插件先拿到决定权。
 * 例如「频率限制」应排在「敏感词过滤」之前，先挡掉明显的刷子。
 */
const ALL_PLUGINS: RinPlugin[] = [
  commentGuard,
  photoAlbum,
];

/**
 * 注册全部插件。
 *
 * 重复调用是安全的（先清空再注册），便于测试隔离。
 * 单个插件注册失败只跳过它并打日志，不影响其他插件 ——
 * 插件是扩展功能，不该让主站起不来。
 */
export function registerPlugins(): void {
  pluginRegistry.reset();

  for (const plugin of ALL_PLUGINS) {
    try {
      pluginRegistry.register(plugin);
    } catch (error) {
      const name = plugin?.manifest?.name ?? 'unknown';
      console.error(`[plugins] failed to register ${name}:`, error);
    }
  }

  const registered = pluginRegistry.list();
  console.log(
    `[plugins] ${registered.length} plugin(s) registered: ` +
      registered.map((p) => p.manifest.name).join(', '),
  );
}

export { pluginRegistry } from './registry';
export type * from './types';
