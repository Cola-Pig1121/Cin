/**
 * 插件管理 API（管理员）。
 *
 * 挂在 `/api/admin/plugins`，与用户管理同前缀 —— 都是后台管理资源。
 *
 * 启停的取舍：状态存在 `serverConfig.plugins.enabled`（逗号分隔的插件名列表），
 * 而不是逐个 boolean 键。存列表的好处是插件增删时不用清理孤儿键。
 *
 * 列表接口会带上每个插件的「声明了哪些能力」，方便管理员一眼看出
 * 某个插件到底能干什么，而不必去读代码。
 */

import { Hono } from "hono";
import { FEED_ERROR_CODES } from "@rin/api";
import type { AppContext } from "../core/hono-types";

import { ENABLED_KEY, pluginRegistry } from "../plugins/registry";
import type { RegisteredPlugin } from "../plugins/types";

/**
 * 判断插件声明了哪些扩展点。
 *
 * 返回给人看的，不给机器读 —— 后台展示用。
 */
function describeCapabilities(entry: RegisteredPlugin): string[] {
  const caps: string[] = [];
  if (entry.hooks.comment?.beforeCreate) caps.push('comment.beforeCreate');
  if (entry.hooks.comment?.afterCreate) caps.push('comment.afterCreate');
  if (entry.hooks.comment?.beforeDelete) caps.push('comment.beforeDelete');
  if (entry.hooks.feed?.beforeSave) caps.push('feed.beforeSave');
  if (entry.hooks.feed?.afterSave) caps.push('feed.afterSave');
  if (entry.hooks.feed?.afterDelete) caps.push('feed.afterDelete');
  if (entry.hooks.routes) caps.push('routes');
  if (entry.hooks.setup) caps.push('setup');
  return caps;
}

/**
 * 管理员鉴权，区分 401 与 403。
 *
 * 不用 `adminOnly`：它对「未登录」和「已登录非管理员」一律返回 401，
 * 但 401 意味着「请重新登录」，会让调用方在权限问题上白跑一趟。
 */
function adminJson(handler: (c: AppContext) => Promise<Response> | Response) {
  return async (c: AppContext) => {
    if (!c.get('uid')) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (!c.get('admin')) {
      return c.json({ error: 'Administrator permission required' }, 403);
    }
    return handler(c);
  };
}

export function AdminPluginService(): Hono {
  const app = new Hono();

  /**
   * GET /api/admin/plugins
   *
   * 列出全部插件及其状态。
   */
  app.get('/', adminJson(async (c: AppContext) => {
    const entries = pluginRegistry.list();

    return c.json({
      enabledKey: ENABLED_KEY,
      plugins: entries.map((entry) => ({
        name: entry.manifest.name,
        displayName: entry.manifest.displayName,
        version: entry.manifest.version,
        description: entry.manifest.description ?? '',
        author: entry.manifest.author ?? '',
        status: entry.status,
        error: entry.error ?? null,
        capabilities: describeCapabilities(entry),
        /** 路由前缀，仅当插件声明了 routes 钩子 */
        apiPrefix: entry.hooks.routes ? `/plugins/${entry.manifest.name}` : null,
      })),
    });
  }));

  /**
   * PUT /api/admin/plugins/:name
   *
   * 启用或停用插件。
   *
   * body: `{ enabled: boolean }`
   *
   * 停用是「从启用列表里移除」而不是「停用列表里加禁用项」——
   * 后者会让列表无限增长，且新插件默认被禁用。
   */
  app.put('/:name', adminJson(async (c: AppContext) => {
    const name = c.req.param('name');

    const entry = pluginRegistry.list().find((p) => p.manifest.name === name);
    if (!entry) {
      return c.json(
        { success: false, error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${name}` } },
        404,
      );
    }

    // 出错的插件不允许切换：它没跑起来，启用也不会自动修好，
    // 反而会让管理员误以为已经生效
    if (entry.status === 'error') {
      return c.json(
        {
          success: false,
          error: {
            code: 'PLUGIN_ERRORED',
            message: `Plugin failed to load: ${entry.error ?? 'unknown error'}`,
          },
        },
        409,
      );
    }

    const body = await c.req.json().catch(() => null) as { enabled?: unknown } | null;
    if (body === null || typeof body.enabled !== 'boolean') {
      return c.json(
        {
          success: false,
          error: {
            code: FEED_ERROR_CODES.FEED_VALIDATION_FAILED,
            message: 'Body must be { enabled: boolean }',
          },
        },
        400,
      );
    }

    const serverConfig = c.get('serverConfig');
    const raw = await serverConfig.get(ENABLED_KEY);

    // 复用 registry 的解析规则，保证读回来和写进去是同一套语义
    const current = parseNames(raw);
    const next = body.enabled
      ? [...new Set([...current, name])]
      : current.filter((item) => item !== name);

    await serverConfig.set(ENABLED_KEY, next.join(','), true);

    // 立刻更新内存状态：不等下一个请求，
    // 这样管理接口返回后前端刷新列表看到的就是新状态
    pluginRegistry.setStatus(name, body.enabled ? 'enabled' : 'disabled');
    await pluginRegistry.syncEnabledFromConfig(serverConfig);

    console.log(
      `[plugins] ${body.enabled ? 'enabled' : 'disabled'} ${name} by admin`,
    );

    return c.json({
      success: true,
      data: {
        name,
        status: body.enabled ? 'enabled' : 'disabled',
        enabledKey: ENABLED_KEY,
        enabledList: next,
      },
    });
  }));

  return app;
}

/** 解析启用列表。与 registry 内部逻辑保持一致 */
function parseNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return [];
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}
