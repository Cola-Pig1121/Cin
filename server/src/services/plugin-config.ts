/**
 * 插件的公开配置读取。
 *
 * 挂到 `/api/plugins/:name/config`，**无需登录**。
 *
 * 为什么需要它：前端插件组件要读自己的设置（比如轮播图放哪些图），
 * 但 serverConfig 里混着 SMTP 密码、AI API Key 等敏感值，不能整体下发。
 * 所以只有插件在 manifest 里用 `publicSettings` 显式声明过的键会被返回。
 *
 * 未声明 `publicSettings` 的插件 → 返回空对象，插件自行决定降级行为。
 */

import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { pluginRegistry } from "../plugins/registry";

/** 缓存头：配置改动不频繁，但也不该每次都回源 */
const CACHE_CONTROL = 'public, max-age=60';

export function PluginConfigService(): Hono {
  const app = new Hono();

  /**
   * GET /api/plugins/:name/config
   *
   * 返回 `{ values: Record<string, string> }`，只含公开键。
   */
  app.get('/:name/config', async (c: AppContext) => {
    const name = c.req.param('name');

    // 停用的插件不该对外提供配置 —— 它本来就不该工作
    const entry = pluginRegistry.list().find((p) => p.manifest.name === name);
    if (!entry || entry.status === 'disabled' || entry.status === 'error') {
      return c.json({ success: false, error: { code: 'PLUGIN_UNAVAILABLE' } }, 404);
    }

    const keys = pluginRegistry.publicSettingsOf(name);
    if (keys.length === 0) {
      return c.json({ name, values: {} }, 200, { 'Cache-Control': CACHE_CONTROL });
    }

    const serverConfig = c.get('serverConfig');
    const values: Record<string, string> = {};

    // 逐键读取。配置量很小（一个插件最多十几个键），
    // 不值得为它引入批量读接口 —— 也避开了 getByPrefix 的实现差异。
    for (const key of keys) {
      // 只读插件自己声明过的键，杜绝越权读取其他配置
      const value = await serverConfig.get(`${name}.${key}`);
      if (value !== null && value !== undefined) {
        values[key] = String(value);
      }
    }

    return c.json({ name, values }, 200, { 'Cache-Control': CACHE_CONTROL });
  });

  return app;
}
