/**
 * 服务端 SEO 头注入：SPA 的 HTML 由 Worker 直接返回，社交爬虫不执行 JS，
 * 因此在返回 index.html 前，按当前路由把标题/描述/封面/URL 注入 OG/Twitter 标签。
 * 仅对能解析成文章的路线查库；其余页面保留 index.html 里的默认标签。
 */

interface D1All<T> {
    results: T[];
}

interface FeedRow {
    title: string | null;
    summary: string | null;
    content: string;
    alias: string | null;
}

interface SiteConfigRow {
    key: string;
    value: string | null;
}

export interface SeoHead {
    title: string;
    description: string;
    image?: string;
    url: string;
    type: "website" | "article";
    siteName: string;
}

// 这些一级路径是应用页面而非文章别名，不触发按别名查库
const RESERVED = new Set([
    "admin", "api", "login", "register", "callback", "profile", "writing",
    "moments", "friends", "hashtags", "hashtag", "timeline", "answerbook",
    "queue-status", "health", "compat-tasks", "settings", "rss", "atom", "feed",
]);

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 从 Markdown/HTML 正文取纯文本摘要 */
function plainSummary(content: string, limit = 160): string {
    const text = content
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/![[^\]]*]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/[#>*_`~-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 取正文首图（markdown 或 img 标签），仅 http(s) */
function firstImage(content: string): string | undefined {
    const md = content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)/);
    if (md) return md[1];
    const img = content.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    return img?.[1];
}

async function findFeed(db: D1Database, key: { alias?: string; id?: string }): Promise<FeedRow | null> {
    const sql = "SELECT title, summary, content, alias FROM feeds WHERE (alias = ?1 OR id = ?2) LIMIT 1";
    const { results } = await db.prepare(sql).bind(key.alias ?? "", key.id ?? "").all<FeedRow>();
    return results?.[0] ?? null;
}

/** 读站点级配置（client.config），用于 og:site_name 与 og:image 兜底 */
async function findSiteConfig(db: D1Database): Promise<{ name?: string; avatar?: string }> {
    try {
        const sql = "SELECT key, value FROM cache WHERE type = ?1 AND key IN ('site.name', 'site.avatar')";
        const { results } = await db.prepare(sql).bind("client.config").all<SiteConfigRow>();
        const out: { name?: string; avatar?: string } = {};
        for (const row of results ?? []) {
            if (row.key === "site.name" && row.value) out.name = row.value;
            if (row.key === "site.avatar" && row.value) out.avatar = row.value;
        }
        return out;
    } catch {
        return {};
    }
}

/** 解析路由对应的 SEO 头；非文章或查不到返回 null（用默认标签） */
export async function resolveSeoHead(pathname: string, origin: string, db: D1Database): Promise<SeoHead | null> {
    let alias: string | undefined;
    let id: string | undefined;

    const feedMatch = pathname.match(/^\/feed\/([^/]+)$/);
    const postMatch = pathname.match(/^\/post\/([^/]+)$/);
    const singleMatch = pathname.match(/^\/([^/]+)$/);

    if (feedMatch) {
        id = decodeURIComponent(feedMatch[1]);
    } else if (postMatch) {
        alias = decodeURIComponent(postMatch[1]);
    } else if (singleMatch && !singleMatch[1].includes(".") && !RESERVED.has(singleMatch[1])) {
        alias = decodeURIComponent(singleMatch[1]);
    } else {
        return null;
    }

    let row: FeedRow | null;
    try {
        row = await findFeed(db, { alias, id });
    } catch {
        return null;
    }
    if (!row) return null;

    const site = await findSiteConfig(db);
    const title = row.title || "未命名";
    return {
        title,
        description: (row.summary && row.summary.trim()) || plainSummary(row.content || ""),
        image: absoluteUrl(firstImage(row.content || "") || site.avatar, origin),
        url: `${origin}${pathname}`,
        type: "article",
        siteName: site.name || "Rin",
    };
}

/** 把图片地址规整成绝对 http(s) URL；data:/其它协议返回 undefined */
function absoluteUrl(raw: string | undefined, origin: string): string | undefined {
    if (!raw) return undefined;
    const value = raw.trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) return `${origin}${value}`;
    return undefined; // data: 或相对路径无法可靠解析，跳过
}

/** 把 SEO 块（<!--SEO:BEGIN--> ... <!--SEO:END-->）替换为给定标签；无 seo 或无标记则原样返回 */
export function injectSeoHead(html: string, seo: SeoHead | null): string {
    if (!seo) return html;
    const block = [
        `<title>${escapeHtml(seo.title)}</title>`,
        `<meta name="description" content="${escapeHtml(seo.description)}" />`,
        `<link rel="canonical" href="${escapeHtml(seo.url)}" />`,
        `<meta property="og:type" content="${seo.type}" />`,
        `<meta property="og:site_name" content="${escapeHtml(seo.siteName)}" />`,
        `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
        `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
        `<meta property="og:url" content="${escapeHtml(seo.url)}" />`,
        seo.image ? `<meta property="og:image" content="${escapeHtml(seo.image)}" />` : "",
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
        seo.image ? `<meta name="twitter:image" content="${escapeHtml(seo.image)}" />` : "",
    ].filter(Boolean).join("\n    ");

    if (/<!--SEO:BEGIN-->/.test(html)) {
        return html.replace(/<!--SEO:BEGIN-->[\s\S]*?<!--SEO:END-->/, `<!--SEO:BEGIN-->\n    ${block}\n    <!--SEO:END-->`);
    }
    return html.replace("</head>", `    ${block}\n  </head>`);
}
