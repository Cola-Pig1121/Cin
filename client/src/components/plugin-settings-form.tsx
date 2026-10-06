import type { PluginSetting, PluginSettingField } from "../plugins/registry";
import { useCallback, useState } from "react";
import { client } from "../app/runtime";
import { apiErrorText } from "../utils/api-error";
import { ImageWithFallback } from "./image-with-fallback";

/**
 * 插件设置表单渲染器。
 *
 * 插件声明 `settings`（键、标签、字段类型），这里据此生成表单。
 * **插件作者不用写任何表单代码**，用户只填值。
 *
 * 值统一以字符串形态进 serverConfig（数组用逗号分隔），
 * 与 config 体系的既有存储方式一致。
 */

/** 把声明的默认值转成表单里的字符串值 */
function initialValue(setting: PluginSetting): string {
  const raw = setting.defaultValue;
  if (raw === undefined) return '';
  if (Array.isArray(raw)) return raw.join(',');
  return String(raw);
}

export function PluginSettingsForm({
  pluginName,
  settings,
  initialValues,
  onSaved,
}: {
  pluginName: string;
  settings: PluginSetting[];
  initialValues: Record<string, string>;
  onSaved: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    // 服务端已有的值优先；没有才用声明的默认值
    const initial: Record<string, string> = {};
    for (const setting of settings) {
      initial[setting.key] = initialValues[setting.key] ?? initialValue(setting);
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  /**
   * 持久错误提示。
   *
   * 之前只用 `window.alert` 报错，上传失败时弹窗一闪而过，
   * 用户只看到「图片没加进去」却不知道为什么。
   * 尤其存储服务不可用（如 Supabase 530）时，alert 容易被忽略。
   */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function save() {
    setSaving(true);
    setErrorMessage(null);
    const { error } = await client.adminPlugin.saveSettings(pluginName, values);
    setSaving(false);

    if (error) {
      setErrorMessage(apiErrorText(error));
      return;
    }
    onSaved(values);
  }

  async function uploadImage(settingKey: string, file: File) {
    setUploadingKey(settingKey);
    setErrorMessage(null);

    // 传 key 让存储按插件名归类，方便日后清理
    const { data, error } = await client.storage.upload(file, `${pluginName}/${file.name}`);
    setUploadingKey(null);

    if (error || !data?.url) {
      // 明确区分「请求失败」与「返回了但没有 url」——
      // 后者通常是存储服务异常（5xx），用户需要知道不是自己操作错了
      const message = error
        ? apiErrorText(error)
        : '图片上传失败：存储服务没有返回图片地址。若刚配置完存储，可能是服务尚未就绪，或图片存储后端当前不可用';
      setErrorMessage(message);
      return;
    }

    // 图片列表是逗号分隔的 URL，追加到末尾
    const current = values[settingKey] ?? '';
    const next = current ? `${current},${data.url}` : data.url;
    setValue(settingKey, next);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 持久错误提示：不用 alert，避免一闪而过被忽略 */}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      {settings.map((setting) => (
        <SettingField
          key={setting.key}
          setting={setting}
          value={values[setting.key] ?? ''}
          uploading={uploadingKey === setting.key}
          onChange={(next) => setValue(setting.key, next)}
          onUpload={(file) => uploadImage(setting.key, file)}
        />
      ))}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-theme px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>    </div>
  );
}

function SettingField({
  setting,
  value,
  uploading,
  onChange,
  onUpload,
}: {
  setting: PluginSetting;
  value: string;
  uploading: boolean;
  onChange: (next: string) => void;
  onUpload: (file: File) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{setting.label}</label>
      {setting.description && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {setting.description}
        </p>
      )}

      <FieldInput
        field={setting.field}
        value={value}
        uploading={uploading}
        onChange={onChange}
        onUpload={onUpload}
      />
    </div>
  );
}

function FieldInput({
  field,
  value,
  uploading,
  onChange,
  onUpload,
}: {
  field: PluginSettingField;
  value: string;
  uploading: boolean;
  onChange: (next: string) => void;
  onUpload: (file: File) => void;
}) {
  const inputClass =
    'w-full rounded-lg border border-black/10 bg-w px-3 py-2 text-sm dark:border-white/10';

  switch (field.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          {value === 'true' ? '已开启' : '已关闭'}
        </label>
      );

    case 'number':
      return (
        <input
          type="number"
          className={inputClass}
          value={value}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'textarea':
      return (
        <textarea
          className={inputClass}
          rows={field.rows ?? 3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'select':
      return (
        <select
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'stringList':
      return (
        <input
          type="text"
          className={inputClass}
          value={value}
          placeholder={field.itemPlaceholder ?? '用逗号分隔'}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'imageList':
      return <ImageListInput value={value} uploading={uploading} onChange={onChange} onUpload={onUpload} />;

    case 'text':
    default:
      return (
        <input
          type="text"
          className={inputClass}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * 图片列表：每一项可上传或填网址。
 *
 * 存成逗号分隔的 URL 串 —— 配置只能存文本，
 * 保持简单比引入嵌套结构更值得。
 */
function ImageListInput({
  value,
  uploading,
  onChange,
  onUpload,
}: {
  value: string;
  uploading: boolean;
  onChange: (next: string) => void;
  onUpload: (file: File) => void;
}) {
  const urls = value.split(',').map((s) => s.trim()).filter(Boolean);

  const setUrls = (next: string[]) => onChange(next.join(','));

  return (
    <div className="flex flex-col gap-3">
      {/* 已有图片：缩略图 + 删除 */}
      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {urls.map((url) => (
            <div key={url} className="relative">
              <ImageWithFallback
                src={url}
                alt={url}
                className="h-20 w-full rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => setUrls(urls.filter((item) => item !== url))}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-black/80"
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 空状态提示：没有图片时插件不会显示任何东西 */}
      {urls.length === 0 && (
        <p className="rounded-lg bg-secondary p-3 text-xs text-neutral-600 dark:text-neutral-300">
          还没有添加图片。保存后若前台没有显示轮播，多半是这里还是空的 ——
          请先上传图片或填写图片网址。
        </p>
      )}

      {/* 上传 */}
      <label
        className={
          'inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 bg-secondary px-4 py-2 text-sm hover:bg-w dark:border-white/10'
        }
      >
        {uploading ? '上传中…' : '上传图片'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            // 清空以便再次选择同一文件也能触发 change
            e.target.value = '';
          }}
        />
      </label>

      {/* 手填网址 */}
      <input
        type="url"
        className="w-full rounded-lg border border-black/10 bg-w px-3 py-2 text-sm dark:border-white/10"
        placeholder="或直接填写图片网址，回车添加"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const input = e.currentTarget;
          const url = input.value.trim();
          if (!url) return;
          setUrls([...urls, url]);
          input.value = '';
        }}
      />
    </div>
  );
}
