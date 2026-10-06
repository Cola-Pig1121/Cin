/**
 * 插件系统的核心类型定义。
 *
 * 设计取向：**轻量 + 显式**。
 * - 插件是编译期内置的（放在 `server/plugins/`），随仓库一起构建
 * - 插件完全受信任：能访问 db / cache / config / env
 * - 因此本文件不设权限模型，重点是**把扩展点写清楚**
 *
 * ## 为什么不用运行时动态加载
 * Worker 环境下动态 import 外部代码无法做类型检查，
 * 插件出错会在运行时才暴露；编译期内置则能在构建期暴露。
 * 自用型项目不需要生态，够用即可。
 */

import type {
  AppContext,
  CacheImpl,
  DB,
} from '../core/hono-types';
import type { Hono } from 'hono';

/**
 * 插件清单。每个插件必须导出这个对象。
 *
 * `name` 是唯一标识，用于配置查找、启停开关与日志。
 * 全小写 kebab-case，避免与路由前缀混淆。
 */
export interface PluginManifest {
  /** 全局唯一的小写短横线标识，如 `comment-guard` */
  name: string;
  /** 展示名，如「评论敏感词过滤」 */
  displayName: string;
  /** 版本号，修改插件行为时应递增 */
  version: string;
  /** 一句话说明这个插件做什么。显示在后台插件列表里 */
  description?: string;
  /** 作者名或仓库地址 */
  author?: string;
}

/**
 * 评论生命周期钩子。
 *
 * 顺序固定为 `beforeCreate` → `afterCreate`。
 * `beforeCreate` 里抛错即可拦截本次提交。
 */
export interface CommentHooks {
  /**
   * 评论提交**前**。返回非空字符串会**拒绝**本次提交。
   *
   * 用于：敏感词过滤、频率限制、黑名单校验。
   * 抛错同样能拦截，且能带上自定义错误码。
   */
  beforeCreate?(input: CommentInput, ctx: PluginContext): Promise<string | void> | string | void;

  /**
   * 评论创建**后**。此时评论已落库。
   *
   * 用于：通知推送、同步到第三方、异步富文本处理。
   * 抛错**不会**回滚评论（评论已创建），只记录日志。
   */
  afterCreate?(comment: CreatedComment, ctx: PluginContext): Promise<void> | void;

  /**
   * 评论删除前。可用于级联清理插件自己附加的数据。
   */
  beforeDelete?(comment: { id: number; userId: number | null }, ctx: PluginContext): Promise<void> | void;
}

/** 传给 `beforeCreate` 的评论输入（尚未落库） */
export interface CommentInput {
  feedId: number;
  content: string;
  /** 登录用户 id；游客为 null */
  userId: number | null;
  guestName?: string;
  guestEmail?: string;
  guestWebsite?: string;
  /** 调用方是否已登录 */
  isLoggedIn: boolean;
  /** 调用方是否为管理员 */
  isAdmin: boolean;
}

/** 传给 `afterCreate` 的已创建评论 */
export interface CreatedComment {
  id: number;
  feedId: number;
  userId: number | null;
  content: string;
  authorName: string;
  approved: boolean;
}

/** 文章生命周期钩子 */
export interface FeedHooks {
  /**
   * 文章创建/更新**前**。返回非空字符串会拒绝。
   *
   * 用于：字段规范化、敏感词过滤、AI 摘要生成前处理。
   */
  beforeSave?(input: FeedInput, ctx: PluginContext): Promise<string | void> | string | void;

  /**
   * 文章创建/更新**后**。
   * 用于：重建索引、推送订阅、清理缓存。
   */
  afterSave?(feed: { id: number; title: string; content: string }, ctx: PluginContext): Promise<void> | void;

  /**
   * 文章删除后。用于清理插件附加数据。
   */
  afterDelete?(feed: { id: number }, ctx: PluginContext): Promise<void> | void;
}

export interface FeedInput {
  id?: number;
  title: string;
  content: string;
  /** 相对原内容是否有改动。为 false 时插件可跳过昂贵处理 */
  changed: boolean;
}

/** 插件可访问的上下文 */
export interface PluginContext {
  db: DB;
  cache: CacheImpl;
  serverConfig: CacheImpl;
  clientConfig: CacheImpl;
  env: Env;
  /** 请求上下文；后台任务里为 undefined */
  request?: AppContext;
  /** 插件自己的日志，带插件名前缀便于过滤 */
  log: PluginLogger;
  /** 读取插件配置。key 形如 `blockedWords`，自动加上插件名前缀 */
  config: PluginConfigReader;
}

/** 插件日志。自动带上插件名前缀 */
export interface PluginLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * 插件配置读取。
 *
 * 插件的配置走现有 serverConfig 体系，前缀用插件名，
 * 这样在后台「服务器配置」里能按 `插件名.配置项` 看到。
 */
export interface PluginConfigReader {
  /**
   * 读字符串。缺失时返回 `defaultValue`。
   *
   * key 不含插件名前缀，内部会自动拼成 `{插件名}.{key}`。
   * 用法：`ctx.config.string('blocklist', '')`
   */
  string(key: string, defaultValue: string): Promise<string>;
  /** 读数字 */
  number(key: string, defaultValue: number): Promise<number>;
  /** 读布尔 */
  boolean(key: string, defaultValue: boolean): Promise<boolean>;
  /** 读字符串数组（存储时用逗号分隔） */
  stringList(key: string, defaultValue: string[]): Promise<string[]>;
}

/**
 * 自定义 API 端点。
 *
 * 插件把自己的 Hono 子路由挂到 `/plugins/{插件名}/` 下。
 * `app` 是插件私有子应用，插件自行决定鉴权。
 */
export type RoutesHook = (app: Hono) => void;

/**
 * 插件可扩展的全部能力。
 *
 * 所有字段都是可选的 —— 只想监听评论的插件不必碰其他钩子。
 * 未提供的钩子在注册时被跳过，不产生任何运行时开销。
 */
export interface PluginHooks {
  comment?: CommentHooks;
  feed?: FeedHooks;
  /**
   * 挂载自定义路由到 `/plugins/{name}/`。
   * 插件自己决定是否校验 `c.get('admin')`。
   */
  routes?: RoutesHook;
  /**
   * 应用启动时执行一次。用于初始化监听器、预热缓存。
   * 抛错会让该插件被跳过，不影响其他插件。
   */
  setup?(ctx: PluginContext): Promise<void> | void;
}

/**
 * 一个完整的插件：清单 + 钩子。
 *
 * 约定每个插件是 `server/plugins/<name>/index.ts`，
 * 默认导出一个实现了本接口的对象。
 */
export interface RinPlugin extends PluginHooks {
  manifest: PluginManifest;
  /**
   * 可公开读取的配置键（不含插件名前缀）。
   *
   * 前端的插件组件要读自己的设置，但 serverConfig 里混着 SMTP 密码、
   * AI API Key 等敏感值，**不能整体下发**。所以由插件显式声明哪些键
   * 是公开数据（如轮播图的 URL 列表），只有这些会被 `/api/plugins/:name/config` 返回。
   *
   * 留空 = 不对外公开任何配置。此时插件若要在前端展示配置，
   * 得自己提供 API，或把设置放在 clientConfig 里。
   */
  publicSettings?: string[];
}

/**
 * 已注册的插件实例。
 *
 * 字段设计让「不启用」有明确表示：
 * - `status: 'enabled'` 才会参与钩子派发
 * - `error` 非空表示 load 或 setup 失败，原因写在这里
 */
export interface RegisteredPlugin {
  manifest: PluginManifest;
  hooks: PluginHooks;
  /** 声明为可公开的配置键。供前端的插件组件读取自身设置 */
  publicSettings: string[];
  status: 'enabled' | 'disabled' | 'error';
  /** 加载或 setup 失败的原因。status 为 'error' 时非空 */
  error?: string;
}
