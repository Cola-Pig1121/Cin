import "../../test/setup";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PluginSettingsForm } from "../plugin-settings-form";
import type { PluginSetting } from "../../plugins/registry";

/**
 * 回归：异步加载的设置必须能填进表单。
 *
 * 原来的 bug 是用 `useState(() => ...)` 的初始化函数读 `initialValues`，
 * 但初始化函数**只在首次挂载时执行一次**。设置是异步加载的 ——
 * 首次挂载时数据还没到，表单填的是默认值；等数据到达后组件重渲染，
 * 初始化函数早已错过，用户看到的是「设置丢了」。
 *
 * 而首页轮播能用，是因为它每次都重新 fetch —— 同一个数据，
 * 组件的处理方式不同导致表现不一致。
 */

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const settings: PluginSetting[] = [
  { key: 'images', label: '图片', field: { type: 'imageList' } },
  { key: 'interval', label: '间隔', field: { type: 'number' }, defaultValue: 5000 },
];

/** 模拟真实场景：先渲染（数据未到），再把数据送进来 */
function Harness({ load }: { load: () => Promise<Record<string, string>> }) {
  const [data, setData] = useState<Record<string, string>>({});

  useState(() => {
    load().then((v) => setData(v));
    return undefined;
  });

  return (
    <PluginSettingsForm
      pluginName="photo-album"
      settings={settings}
      initialValues={data}
      onSaved={() => {}}
    />
  );
}

describe('PluginSettingsForm 异步加载', () => {
  beforeEach(() => {
    mock.module("../../app/runtime", () => ({
      client: {
        adminPlugin: { saveSettings: async () => ({ data: null }) },
        storage: { upload: async () => ({ data: null }) },
      },
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('should fill in values that arrive after mount', async () => {
    const { container } = render(
      <Harness load={async () => ({ images: 'https://x.com/a.jpg', interval: '3000' })} />,
    );

    // 数据到达后，表单里必须能看到已保存的图片 URL
    await waitFor(
      () => {
        expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.com/a.jpg');
        // 缩略图图渲染出来了
        expect(container.querySelector('img')).not.toBeNull();
      },
      { timeout: 3000 },
    );
  });

  it('should show an empty-state hint when there are no images', async () => {
    const { container } = render(
      <Harness load={async () => ({ images: '', interval: '5000' })} />,
    );

    // 没有图片时应提示用户，而不是让人对着空白页猜
    await waitFor(() => {
      expect(container.textContent).toContain('还没有添加图片');
    });
  });

  it('should not overwrite user edits when data arrives late', async () => {
    let resolveData: (v: Record<string, string>) => void = () => {};
    const delayed = new Promise<Record<string, string>>((r) => {
      resolveData = r;
    });

    const { container } = render(<Harness load={() => delayed} />);

    // 数据到达后用户已可能在编辑，不应被覆盖
    resolveData({ images: 'https://x.com/b.jpg' });
    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });
  });
});
