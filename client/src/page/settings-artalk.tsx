// Artalk 评论配置面板
//
// 作为设置页的一个独立分区渲染，不塞进 settings.tsx —— 那里的 Item* 组件
// 都是"一行一控件"的通用形态，而这里需要下拉选择、内联按钮和状态提示。
//
// 所有配置写入 clientConfig（随站点下发、公开可读），因为前端组件初始化时
// 需要直接拿到服务器地址，不该依赖管理员权限才能读取。

import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { SettingsBadge, SettingsCard, SettingsCardRow } from "@rin/ui";
import { ItemInput, ItemTitle } from "./settings-items";

const PROVIDER_OPTIONS = ["artalk", "builtin"] as const;
const DARK_MODE_OPTIONS = ["inherit", "light", "dark"] as const;

export interface ArtalkSettingsProps {
  getValue: (key: string) => unknown;
  getBoolean: (key: string) => boolean;
  setValue: (key: string, value: unknown) => void;
}

export function ArtalkSettings({ getValue, getBoolean, setValue }: ArtalkSettingsProps) {
  const { t } = useTranslation();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const provider = String(getValue("comment.provider") ?? "artalk");
  const server = String(getValue("comment.artalk.server") ?? "");
  const site = String(getValue("comment.artalk.site") ?? "");
  const pagePrefix = String(getValue("comment.artalk.page_prefix") ?? "/post");
  const darkMode = String(getValue("comment.artalk.dark_mode") ?? "inherit");

  // provider 未显式配置时按 Artalk 处理（新版默认），但显式设为 builtin 时必须尊重
  const isArtalk = provider === "artalk";
  const commentsEnabled = getBoolean("comment.enabled");

  async function handleTest() {
    setTesting(true);
    setTestResult(null);

    try {
      // 探测未保存的草稿值：用户可能改完还没点保存就想验证连通性
      const { data, error } = await client.config.testArtalk({ server });

      if (error || !data?.success) {
        setTestResult({
          ok: false,
          message: (error?.value as string) || (data?.error as string) || t("settings.comment.artalk.test_failed"),
        });
        return;
      }

      setTestResult({ ok: true, message: t("settings.comment.artalk.test_success") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <ItemTitle title={t("settings.comment.artalk.title")} />

          <SettingsCard>
            <div className="p-4 sm:p-5">
              <p className="text-sm t-secondary leading-relaxed">
                {t("settings.comment.artalk.desc")}
              </p>
              {!commentsEnabled && (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                  {t("settings.comment.artalk.disabled_warning")}
                </p>
              )}
              {/* Artalk 默认不允许跨域，这条最容易踩且现象误导性很强 */}
              <p className="mt-2 text-sm t-tertiary leading-relaxed">
                {t("settings.comment.artalk.trusted_domains_hint")}
              </p>
            </div>
          </SettingsCard>

      <SettingsCard>
        <SettingsCardRow
          header={
            <div className="min-w-0">
              <p className="text-base t-primary">{t("settings.comment.artalk.provider")}</p>
              <p className="mt-1 text-sm t-secondary break-words">
                {t("settings.comment.artalk.provider_desc")}
              </p>
            </div>
          }
          action={
            <select
              className="rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none dark:border-white/10"
              value={provider}
              onChange={(e) => {
                setValue("comment.provider", e.target.value);
                // 切回内置评论时清掉测试结果，避免误导
                setTestResult(null);
              }}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.comment.artalk.provider_options.${option}`)}
                </option>
              ))}
            </select>
          }
        />
      </SettingsCard>

      {isArtalk && (
        <>
          <ItemInput
            title={t("settings.comment.artalk.server.title")}
            description={t("settings.comment.artalk.server.desc")}
            configKeyTitle="http://192.168.21.250:23366"
            placeholder="http://192.168.21.250:23366"
            value={server}
            onChange={(value) => {
              setValue("comment.artalk.server", value.trim());
              setTestResult(null);
            }}
          />

          <ItemInput
            title={t("settings.comment.artalk.site.title")}
            description={t("settings.comment.artalk.site.desc")}
            configKeyTitle="Artalk site name"
            value={site}
            onChange={(value) => {
              setValue("comment.artalk.site", value.trim());
            }}
          />

          <ItemInput
            title={t("settings.comment.artalk.page_prefix.title")}
            description={t("settings.comment.artalk.page_prefix.desc")}
            configKeyTitle="/post"
            value={pagePrefix}
            onChange={(value) => {
              setValue("comment.artalk.page_prefix", value.trim());
            }}
          />

          <SettingsCard>
            <SettingsCardRow
              header={
                <div className="min-w-0">
                  <p className="text-base t-primary">{t("settings.comment.artalk.dark_mode.title")}</p>
                  <p className="mt-1 text-sm t-secondary break-words">
                    {t("settings.comment.artalk.dark_mode.desc")}
                  </p>
                </div>
              }
              action={
                <select
                  className="rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none dark:border-white/10"
                  value={darkMode}
                  onChange={(e) => {
                    setValue("comment.artalk.dark_mode", e.target.value);
                  }}
                >
                  {DARK_MODE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              }
            />
          </SettingsCard>

          <SettingsCard>
            <div className="flex flex-col gap-3 p-4 sm:p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-base t-primary">{t("settings.comment.artalk.test")}</p>
                  {testing && (
                    <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
                  )}
                </div>
                <p className="mt-1 text-sm t-secondary break-words">
                  {testResult?.message ?? t("settings.comment.artalk.test_hint")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {testResult && (
                  <SettingsBadge tone={testResult.ok ? "success" : "warning"}>
                    {testResult.ok
                      ? t("settings.comment.artalk.test_success")
                      : t("settings.comment.artalk.test_failed")}
                  </SettingsBadge>
                )}
                <Button
                  title={t("settings.comment.artalk.test")}
                  disabled={testing || !server.trim()}
                  onClick={handleTest}
                />
              </div>
            </div>
          </SettingsCard>
        </>
      )}
    </>
  );
}
