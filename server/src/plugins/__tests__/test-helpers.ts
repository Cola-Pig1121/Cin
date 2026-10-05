/**
 * 插件测试的公共辅助。
 *
 * 单独抽出来是因为 PluginContext 里有 db / cache 这些重量级依赖，
 * 测试里并不关心它们的实现，但直接 `as PluginContext` 会被 tsc 拒绝
 * （类型重叠不足）。这里用 `unknown` 中转一次，把噪音集中在一处。
 */

import type { CacheImpl } from '../../core/hono-types';
import { createPluginConfigReader } from '../config-reader';
import type { PluginContext } from '../types';

/** 只实现 get 的最小 CacheImpl，够配置读取用 */
export function makeConfig(values: Record<string, unknown>): CacheImpl {
  return {
    get: async (key: string) => (key in values ? (values[key] ?? null) : null),
    getOrDefault: async <T>(key: string, defaultValue: T) =>
      (values[key] as T) ?? defaultValue,
  } as unknown as CacheImpl;
}

/** 静默 logger，避免测试输出被日志淹没 */
export const silentLog = {
  info() {},
  warn() {},
  error() {},
};

/**
 * 构造一个测试用 PluginContext。
 *
 * db / cache 传空对象：插件测试关心的是配置读取与钩子派发，
 * 不涉及真实数据库访问。真要测 DB 行为应该用 setupTestApp 那套。
 */
export function makePluginContext(params: {
  pluginName: string;
  serverConfig?: CacheImpl;
  values?: Record<string, unknown>;
}): PluginContext {
  const serverConfig = params.serverConfig ?? makeConfig(params.values ?? {});

  return {
    db: {} as never,
    cache: {} as never,
    serverConfig,
    clientConfig: serverConfig,
    env: {} as Env,
    log: silentLog,
    config: createPluginConfigReader(params.pluginName, serverConfig),
  };
}
