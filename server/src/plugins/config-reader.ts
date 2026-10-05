/**
 * 插件配置读取。
 *
 * 插件配置复用现有 serverConfig 体系，键名规则是 `{插件名}.{配置项}`。
 * 好处是后台「服务器配置」页能直接编辑，不需要额外的配置存储。
 */

import type { CacheImpl } from '../core/hono-types';
import type { PluginConfigReader } from './types';

/**
 * 创建配置读取器。
 *
 * @param pluginName 插件名，作为配置键的前缀
 * @param config     serverConfig 实例
 */
export function createPluginConfigReader(
  pluginName: string,
  config: CacheImpl,
): PluginConfigReader {
  /** 拼出完整键名。空 key 直接返回前缀，允许读插件级总开关 */
  const fullKey = (key: string): string =>
    key ? `${pluginName}.${key}` : pluginName;

  return {
    async string(key: string, defaultValue: string): Promise<string> {
      const value = await config.get(fullKey(key));
      // 空字符串视为「未设置」：管理后台把输入框清空时存的就是空串，
      // 那表示用默认值，而不是「配置就是一个空字符串」
      if (value === null || value === undefined || value === '') {
        return defaultValue;
      }
      return String(value);
    },

    async number(key: string, defaultValue: number): Promise<number> {
      const raw = await config.get(fullKey(key));
      if (raw === null || raw === undefined || raw === '') {
        return defaultValue;
      }
      const parsed = Number(raw);
      // 存了非数字就用默认值，不要返回 NaN 让下游算崩
      return Number.isFinite(parsed) ? parsed : defaultValue;
    },

    async boolean(key: string, defaultValue: boolean): Promise<boolean> {
      const raw = await config.get(fullKey(key));
      if (raw === null || raw === undefined || raw === '') {
        return defaultValue;
      }
      if (typeof raw === 'boolean') return raw;
      // 配置值可能是字符串 'true' / '1'（管理后台存的都是字符串）
      const normalized = String(raw).trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      // 无法识别的值回落到默认值 —— 与全局「未知值取保守侧」的原则一致
      return defaultValue;
    },

    async stringList(key: string, defaultValue: string[]): Promise<string[]> {
      const raw = await config.get(fullKey(key));
      if (raw === null || raw === undefined || raw === '') {
        return defaultValue;
      }
      // 数组直接返回（配置里存的可能是 JSON），字符串按逗号或换行切分
      if (Array.isArray(raw)) {
        return raw.map((item) => String(item).trim()).filter(Boolean);
      }
      return String(raw)
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    },
  };
}
