/**
 * 首页顶部相册轮播（服务端部分）
 *
 * 这个插件本身不需要服务端钩子 —— 它是纯前端展示。
 * 服务端只做一件事：**声明哪些配置键可以公开给浏览器**。
 *
 * 轮播图里的图片 URL 本来就是要渲染给所有人看的，因此属于公开数据；
 * 但 serverConfig 里还混着 SMTP 密码、AI API Key 等敏感值，
 * 不能整体下发，所以必须由插件显式声明。
 */

import type { RinPlugin } from '../../src/plugins/types';

const plugin: RinPlugin = {
  manifest: {
    name: 'photo-album',
    displayName: '相册轮播',
    version: '1.0.0',
    description: '在页头导航下方展示图片轮播。图片可上传或填网址',
    author: 'Rin',
  },

  // 只有这两个键会被 /api/plugins/photo-album/config 返回。
  // 加新键时记得同步更新 client/plugins/photo-album/index.tsx 的 settings 声明。
  publicSettings: ['images', 'interval', 'height'],
};

export default plugin;
