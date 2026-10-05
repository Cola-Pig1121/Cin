// Artalk 评论组件
//
// Rin 原来自建了一套评论（存 comments 表）。现在把评论交给 Artalk，
// Artalk 是独立部署的评论服务，前端只需按配置挂载它的客户端。
//
// 设计取舍：
//   - 通过 clientConfig 的 comment.provider 在「Artalk」与「Rin 内置」之间切换，
//     保留原实现作为回退，comments 表与接口都不删，迁移可随时回退。
//   - 页面键（pageKey）用文章的稳定标识而不是数字 ID，避免文章改 alias 后
//     评论挂到新页面上丢失。
//   - Artalk 实例是异步初始化的，切换文章时必须销毁上一个实例，否则会互相污染。

import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet";
import { Waiting } from "../components/loading";
import { ClientConfigContext } from "../state/config";
import { useSiteConfig } from "../hooks/useSiteConfig";

import "artalk/Artalk.css";

type ArtalkInstance = {
  destroy?: () => void;
};

/**
 * 从 clientConfig 读取 Artalk 配置。
 * 全部走配置而非硬编码，这样换 Artalk 实例不用改代码。
 */
function useArtalkConfig() {
  const config = useContext(ClientConfigContext);

  const server = String(config.get("comment.artalk.server") ?? "").trim();
  const site = String(config.get("comment.artalk.site") ?? "").trim();
  const darkMode = String(config.get("comment.artalk.dark_mode") ?? "inherit");
  const pagePrefix = String(config.get("comment.artalk.page_prefix") ?? "").trim();

  return {
    enabled: config.getBoolean("comment.enabled") !== false,
    provider: String(config.get("comment.provider") ?? "builtin"),
    server,
    site,
    darkMode,
    pagePrefix,
  };
}

export function ArtalkComments({ id, title }: { id: string; title?: string }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const { server, site, darkMode, pagePrefix } = useArtalkConfig();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ArtalkInstance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 页面键：默认 /post/<id>，也可加前缀便于迁移
  const pageKey = `${pagePrefix || "/post"}/${id}`;

  useEffect(() => {
    if (!server) {
      setLoadError(t("comment.artalk.no_server"));
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Artalk 客户端约 200KB，动态引入避免拖慢首屏
    import("artalk")
      .then(({ default: Artalk }) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        // Artalk 会在 el 上挂载自己的 DOM 与事件。React 严格模式会二次执行 effect，
        // 因此必须先销毁上一轮实例并清空容器，否则第二次 init 会作用在
        // 已初始化的节点上，导致评论框重复或渲染异常。
        if (instanceRef.current?.destroy) {
          try {
            instanceRef.current.destroy();
          } catch (error) {
            console.warn("[artalk] destroy previous instance failed", error);
          }
          instanceRef.current = null;
        }

        containerRef.current.innerHTML = "";

        const artalk = Artalk.init({
          el: containerRef.current,
          server,
          site: site || siteConfig.name,
          pageKey,
          pageTitle: title || "",
          darkMode: darkMode as "inherit" | "light" | "dark",
          // placeholder 用站点语言，随 i18n 切换
          placeholder: t("comment.placeholder.title") || "",
          noComment: t("comment.artalk.empty") || "",
          sendBtn: t("comment.submit"),
          locale: resolveArtalkLocale(),
        } as any);

        instanceRef.current = artalk as ArtalkInstance;
        setLoadError(null);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error("[artalk] failed to load client", error);
        setLoadError(t("comment.artalk.load_failed"));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (instanceRef.current?.destroy) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
    // title 变化不重建实例：同一篇文章标题可能异步补齐，pageKey 才是身份标识
  }, [server, site, pageKey, darkMode]);

  if (loadError) {
    return (
      <div className="w-full rounded-2xl bg-w t-primary p-6 flex flex-col items-center">
        <Helmet>
          <title>{`${t("comment.title")} - ${siteConfig.name}`}</title>
        </Helmet>
        <p className="text-sm t-secondary">{loadError}</p>

        {server ? null : (
          <p className="mt-2 text-xs t-tertiary">{t("comment.artalk.configure_hint")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl bg-w t-primary p-4 sm:p-6">
      <Helmet>
        <title>{`${t("comment.title")} - ${siteConfig.name}`}</title>
      </Helmet>
      {loading && <Waiting />}
      {/* Artalk 会接管这个容器的全部内容 */}
      <div ref={containerRef} />
    </div>
  );
}

/** 把 i18next 语言映射到 Artalk 支持的 locale */
function resolveArtalkLocale(): "zh-CN" | "zh-TW" | "en" | "ja" | "fr" | "ko" | "ru" {
  const lang = typeof navigator !== "undefined" ? navigator.language : "zh-CN";

  if (lang.startsWith("zh")) {
    // 繁简通过浏览器语言的首选区分子标签判断
    return /Hant|TW|HK|MO/i.test(lang) ? "zh-TW" : "zh-CN";
  }
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("ru")) return "ru";

  return "en";
}
