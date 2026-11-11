import { describe, expect, it } from "bun:test";
import { injectSeoHead, resolveSeoHead, type SeoHead } from "../seo-head";

function fakeDb(row: Record<string, unknown> | null, site: { name?: string; avatar?: string } = {}) {
    return {
        prepare: (sql: string) => ({
            bind: () => ({
                all: async () =>
                    sql.includes("FROM feeds")
                        ? { results: row ? [row] : [] }
                        : {
                            results: [
                                ...(site.name ? [{ key: "site.name", value: site.name }] : []),
                                ...(site.avatar ? [{ key: "site.avatar", value: site.avatar }] : []),
                            ],
                        },
            }),
        }),
    } as unknown as D1Database;
}

describe("resolveSeoHead", () => {
    it("returns null for reserved/static paths without querying", async () => {
        const db = fakeDb(null);
        expect(await resolveSeoHead("/", "https://x.dev", db)).toBeNull();
        expect(await resolveSeoHead("/moments", "https://x.dev", db)).toBeNull();
        expect(await resolveSeoHead("/admin/users", "https://x.dev", db)).toBeNull();
        expect(await resolveSeoHead("/assets/a.js", "https://x.dev", db)).toBeNull();
    });

    it("resolves a post by alias with title/description/image", async () => {
        const db = fakeDb({ title: "文章标题", summary: "摘要", content: "正文 ![c](https://cdn/i.png)", alias: "my-post" });
        const seo = await resolveSeoHead("/my-post", "https://blog.dev", db);
        expect(seo).not.toBeNull();
        expect(seo!.title).toBe("文章标题");
        expect(seo!.description).toBe("摘要");
        expect(seo!.image).toBe("https://cdn/i.png");
        expect(seo!.url).toBe("https://blog.dev/my-post");
        expect(seo!.type).toBe("article");
    });

    it("returns null when the alias matches no feed", async () => {
        expect(await resolveSeoHead("/nope", "https://blog.dev", fakeDb(null))).toBeNull();
    });

    it("falls back to the site avatar as og:image when the post has no image", async () => {
        const db = fakeDb({ title: "无图文章", summary: "s", content: "纯文字正文", alias: "a" }, { name: "My Blog", avatar: "/avatar.png" });
        const seo = await resolveSeoHead("/a", "https://blog.dev", db);
        expect(seo!.image).toBe("https://blog.dev/avatar.png");
        expect(seo!.siteName).toBe("My Blog");
    });
});

describe("injectSeoHead", () => {
    const html = `<head><!--SEO:BEGIN-->\n<title>Rin</title>\n<!--SEO:END--></head>`;

    it("replaces the marker block and escapes values", () => {
        const seo: SeoHead = {
            title: `A & "B"`,
            description: "desc <x>",
            url: "https://blog.dev/p",
            type: "article",
            siteName: "Rin",
            image: "https://cdn/i.png",
        };
        const out = injectSeoHead(html, seo);
        expect(out).toContain("<title>A &amp; &quot;B&quot;</title>");
        expect(out).toContain('og:title" content="A &amp; &quot;B&quot;"');
        expect(out).toContain('og:image" content="https://cdn/i.png"');
        expect(out).toContain('canonical" href="https://blog.dev/p"');
        expect(out).not.toContain("<title>Rin</title>");
    });

    it("returns html unchanged when no seo", () => {
        expect(injectSeoHead(html, null)).toBe(html);
    });

    it("falls back to inserting before </head> when markers absent", () => {
        const seo: SeoHead = { title: "T", description: "D", url: "https://x/p", type: "article", siteName: "Rin" };
        const out = injectSeoHead("<head></head>", seo);
        expect(out).toContain("<title>T</title>");
        expect(out).toContain("</head>");
    });
});
