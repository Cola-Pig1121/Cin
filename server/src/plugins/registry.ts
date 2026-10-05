/**
 * 插件运行时：注册、配置读取、钩子派发。
 *
 * 关键设计：
 * - **单个插件失败不影响其他插件**。load 或 setup 抛错只把它标为 error 并跳过
 * - **派发钩子时插件抛错不阻断主流程**。只有 `beforeCreate` 显式返回字符串
 *   或抛 `PluginRejectionError` 才算拦截
 * - 未注册的插件没有任何运行时开销（不生成空函数再逐个判断）
 */

import { Hono as HonoCtor } from 'hono';
import type {
  AppContext,
  CacheImpl,
  DB,
} from '../core/hono-types';
import { createPluginConfigReader } from './config-reader';
import { createPluginLogger } from './logger';
import type {
  CommentHooks,
  CommentInput,
  CreatedComment,
  FeedHooks,
  FeedInput,
  PluginConfigReader,
  PluginContext,
  PluginHooks,
  PluginLogger,
  RegisteredPlugin,
  RinPlugin,
  RoutesHook,
} from './types';

/**
 * 插件主动拒绝本次操作时抛出。
 *
 * 与「插件自己崩了」区分开：抛这个错会得到用户可见的提示，
 * 崩溃则只记日志、不影响主流程。
 */
export class PluginRejectionError extends Error {
  constructor(
    public readonly pluginName: string,
    message: string,
  ) {
    super(message);
    this.name = 'PluginRejectionError';
  }
}

/**
 * 插件注册中心。
 *
 * 全局单例 —— Worker 里每个 isolate 一份，不需要跨请求同步。
 * 类本身也导出，便于测试用独立实例，避免相互污染。
 */
export class PluginRegistry {
  private plugins: RegisteredPlugin[] = [];

  /**
   * 注册一个插件。
   *
   * 会先做基本校验：manifest.name 必须合法且不重复。
   * 校验失败只抛错（这是开发期错误，应该暴露），
   * 但 load 阶段的运行时错误由 `loadAll` 捕获。
   */
  register(plugin: RinPlugin): void {
    validateManifest(plugin.manifest);

    if (this.plugins.some((p) => p.manifest.name === plugin.manifest.name)) {
      throw new Error(`[plugins] duplicate plugin name: ${plugin.manifest.name}`);
    }

    this.plugins.push({
      manifest: plugin.manifest,
      hooks: stripManifest(plugin),
      status: 'enabled',
    });
  }

  /** 列出全部已注册插件（含禁用的），供后台展示 */
  list(): readonly RegisteredPlugin[] {
    return this.plugins;
  }

  /** 找出已启用的插件 */
  enabled(): RegisteredPlugin[] {
    return this.plugins.filter((p) => p.status === 'enabled');
  }

  /**
   * 执行所有已启用插件的 setup。
   *
   * 某个插件 setup 失败只把它标为 error，不影响其他插件。
   *
   * @param getContext 构造插件上下文的方式。setup 阶段通常还没有请求上下文，
   *                   但仍需给出 db/config 等，所以这里传入构造函数
   */
  async loadAll(
    getContext: (pluginName: string) => Promise<PluginContext>,
  ): Promise<void> {
    for (const entry of this.plugins) {
      if (!entry.hooks.setup) continue;

      try {
        const ctx = await getContext(entry.manifest.name);
        await entry.hooks.setup(ctx);
      } catch (error) {
        entry.status = 'error';
        entry.error = error instanceof Error ? error.message : String(error);
        console.error(
          `[plugins] setup failed for ${entry.manifest.name}: ${entry.error}`,
        );
      }
    }
  }

  /**
   * 挂载插件自定义路由到 `/plugins/{name}/`。
   *
   * @param mount 挂载函数，签名与 `app.route()` 一致
   */
  mountRoutes(mount: (path: string, app: PluginApp) => void): void {
    for (const entry of this.enabled()) {
      const routes = entry.hooks.routes;
      if (!routes) continue;

      const app = createHono();
      try {
        // 插件自行决定是否鉴权，这里不预设 admin 检查
        routes(app as never);
        mount(`/plugins/${entry.manifest.name}`, app);
      } catch (error) {
        entry.status = 'error';
        entry.error = error instanceof Error ? error.message : String(error);
        console.error(
          `[plugins] failed to mount routes for ${entry.manifest.name}: ${entry.error}`,
        );
      }
    }
  }

  /**
   * 派发评论提交前钩子。
   *
   * @returns 拦截原因；非空表示应拒绝本次提交
   * @throws PluginRejectionError 插件主动拒绝
   */
  async beforeCommentCreate(
    input: CommentInput,
    ctx: PluginContext,
  ): Promise<string | void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.comment?.beforeCreate;
      if (!hook) continue;

      try {
        const result = await hook(input, ctx);
        if (typeof result === 'string' && result.length > 0) {
          return result;
        }
      } catch (error) {
        if (error instanceof PluginRejectionError) throw error;
        // 其他异常不当成拦截 —— 插件崩溃不该让正常用户发不出评论
        logHookError(entry.manifest.name, 'beforeCreate', error);
      }
    }
    return undefined;
  }

  /**
   * 派发评论创建后钩子。
   *
   * 全部异常都吞掉：评论已落库，不能因为插件失败而回滚或报错。
   */
  async afterCommentCreate(comment: CreatedComment, ctx: PluginContext): Promise<void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.comment?.afterCreate;
      if (!hook) continue;

      try {
        await hook(comment, ctx);
      } catch (error) {
        logHookError(entry.manifest.name, 'afterCreate', error);
      }
    }
  }

  /** 派发评论删除前钩子。异常吞掉，不阻断删除 */
  async beforeCommentDelete(
    comment: { id: number; userId: number | null },
    ctx: PluginContext,
  ): Promise<void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.comment?.beforeDelete;
      if (!hook) continue;

      try {
        await hook(comment, ctx);
      } catch (error) {
        logHookError(entry.manifest.name, 'beforeDelete', error);
      }
    }
  }

  /** 派发文章保存前钩子。返回非空字符串表示拒绝 */
  async beforeFeedSave(input: FeedInput, ctx: PluginContext): Promise<string | void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.feed?.beforeSave;
      if (!hook) continue;

      try {
        const result = await hook(input, ctx);
        if (typeof result === 'string' && result.length > 0) {
          return result;
        }
      } catch (error) {
        if (error instanceof PluginRejectionError) throw error;
        logHookError(entry.manifest.name, 'feed.beforeSave', error);
      }
    }
    return undefined;
  }

  /** 派发文章保存后钩子。异常吞掉 */
  async afterFeedSave(
    feed: { id: number; title: string; content: string },
    ctx: PluginContext,
  ): Promise<void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.feed?.afterSave;
      if (!hook) continue;

      try {
        await hook(feed, ctx);
      } catch (error) {
        logHookError(entry.manifest.name, 'feed.afterSave', error);
      }
    }
  }

  /** 派发文章删除后钩子。异常吞掉 */
  async afterFeedDelete(feed: { id: number }, ctx: PluginContext): Promise<void> {
    for (const entry of this.enabled()) {
      const hook = entry.hooks.feed?.afterDelete;
      if (!hook) continue;

      try {
        await hook(feed, ctx);
      } catch (error) {
        logHookError(entry.manifest.name, 'feed.afterDelete', error);
      }
    }
  }

  /** 供测试用：清空注册表 */
  reset(): void {
    this.plugins = [];
  }
}

function logHookError(pluginName: string, hook: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[plugins] ${pluginName} ${hook} failed: ${message}`);
}

function validateManifest(manifest: RinPlugin['manifest']): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('[plugins] manifest is required');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name ?? '')) {
    throw new Error(
      `[plugins] invalid plugin name "${manifest.name}", expected lowercase kebab-case`,
    );
  }
  if (!manifest.displayName) {
    throw new Error(`[plugins] ${manifest.name}: displayName is required`);
  }
  if (!manifest.version) {
    throw new Error(`[plugins] ${manifest.name}: version is required`);
  }
}

/** 把 manifest 从 hooks 里剥掉，得到纯钩子对象 */
function stripManifest(plugin: RinPlugin): PluginHooks {
  const { manifest: _manifest, ...hooks } = plugin;
  return hooks;
}

// 插件私有子应用的类型。插件自行决定鉴权，所以不套 RinApp 的 Variables。
type PluginApp = HonoCtor<{ Bindings: Env }>;

/**
 * 创建插件私有子应用。
 *
 * 放在 registry 里而不是让插件自己 new，是为了让路由挂载方式统一，
 * 也方便将来换成「带鉴权的子应用」。
 */
function createHono(): PluginApp {
  return new HonoCtor<{ Bindings: Env }>();
}

export const pluginRegistry = new PluginRegistry();

/**
 * 构造插件上下文。
 *
 * 抽成独立函数是因为请求内（带 request）与启动时（无 request）都要用。
 */
export function createPluginContext(params: {
  pluginName: string;
  db: DB;
  cache: CacheImpl;
  serverConfig: CacheImpl;
  clientConfig: CacheImpl;
  env: Env;
  request?: AppContext;
}): PluginContext {
  const { pluginName, ...rest } = params;

  return {
    ...rest,
    log: createPluginLogger(pluginName),
    config: createPluginConfigReader(pluginName, params.serverConfig),
  };
}
