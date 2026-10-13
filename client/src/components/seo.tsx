import { Helmet } from "react-helmet";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * 统一 SEO 头：title / description / canonical / Open Graph / Twitter。
 * 各页面用它声明自己的元信息；站点名、头像、描述取运行时配置。
 * 绝对 URL 基于当前 origin 计算（同一 Worker 同时服务自定义域名与 workers.dev）。
 */
export function Seo({
  title,
  description,
  path,
  image,
  type = "website",
}: {
  title: string;
  description?: string;
  path: string;
  image?: string;
  type?: "website" | "article";
}) {
  const site = useSiteConfig();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const desc = description || site.description || "";
  const ogImage = image ? (image.startsWith("http") ? image : `${origin}${image}`) : site.avatar || undefined;

  return (
    <Helmet>
      <title>{title}</title>
      {desc && <meta name="description" content={desc} />}
      <link rel="canonical" href={url} />

      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={site.name} />
      <meta property="og:title" content={title} />
      {desc && <meta property="og:description" content={desc} />}
      <meta property="og:url" content={url} />
      {ogImage && <meta property="og:image" content={ogImage} />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {desc && <meta name="twitter:description" content={desc} />}
      {ogImage && <meta name="twitter:image" content={ogImage} />}
    </Helmet>
  );
}
