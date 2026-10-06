/**
 * 插件插槽的渲染。
 *
 * 页面插槽（`below-header` / `above-footer`）由这里统一渲染，
 * 两个布局（classic / compact）都用它，避免各自实现一遍。
 *
 * 为什么单独抽一个组件：插槽要在 `<Header>` 与内容之间插入，
 * 而这个位置在 `layout-registry` 的 `renderRouteShell` 里 ——
 * 逻辑放在 AppRoute 里能让布局定义保持纯粹。
 */

import { listPluginSlots, type PluginSlot } from "../plugins/registry";

/**
 * 渲染指定插槽的所有组件。
 *
 * 没匹配到时返回 null，不产生任何 DOM。
 */
export function PluginSlot({ slot, path }: { slot: PluginSlot; path: string }) {
  const items = listPluginSlots(slot, path);
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item, i) => (
        <item.Component key={`${slot}-${i}`} />
      ))}
    </>
  );
}
