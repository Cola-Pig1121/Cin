/**
 * 示例前端插件：一个展示插件信息的小页面。
 *
 * 演示三件事：
 * 1. 注册一个 `/plugin/` 下的页面
 * 2. 用现有的 UI 组件（SettingsCard / SettingsBadge）保持视觉一致
 * 3. 声明它需要管理员权限
 *
 * 它同时在服务端有对应实现（`server/plugins/comment-guard`），
 * 两边 manifest.name 相同即为同一个插件。
 */

import { SettingsBadge, SettingsCard, SettingsCardHeader } from "@rin/ui";
import type { FrontendPlugin } from "../../src/plugins/registry";

function HelloPage() {
  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsCard>
        <SettingsCardHeader
          title="Hello Plugin"
          description="这是一个示例插件页面，用来演示前端扩展怎么用"
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader title="它能做什么" description="插件可以注册任意路径的页面" />
        <div className="mt-3 flex flex-wrap gap-2">
          <SettingsBadge tone="success">React 组件</SettingsBadge>
          <SettingsBadge tone="neutral">TypeScript 类型安全</SettingsBadge>
          <SettingsBadge tone="neutral">复用现有 UI</SettingsBadge>
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader title="安全提醒" description="requireAdmin 只是 UI 隐藏，不是安全边界" />
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          前端能显示组件不代表用户有权访问它背后的数据。
          服务端接口必须各自鉴权。
        </p>
      </SettingsCard>
    </div>
  );
}

const plugin: FrontendPlugin = {
  manifest: {
    name: 'hello',
    displayName: '示例插件',
    version: '1.0.0',
    description: '演示前端页面扩展',
  },
  pages: [
    {
      path: '/plugin/hello',
      title: 'Hello Plugin',
      Component: HelloPage,
      // 演示权限声明。去掉这行任何人都能看到
      requireAdmin: true,
    },
  ],
};

export default plugin;
