// 本地静态资源服务
//
// 替代 Cloudflare Workers 的 ASSETS 绑定，从磁盘目录读取前端构建产物。
// 未命中且路径无扩展名时回退到 index.html，行为对齐 Cloudflare 的
// not_found_handling = "single-page-application"。

import * as fs from "node:fs";
import * as path from "node:path";
import type { AssetProvider } from "./types";

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".map": "application/json; charset=utf-8",
};

export class LocalAssetProvider implements AssetProvider {
    constructor(private readonly rootDir: string) {}

    private resolve(pathname: string): string | null {
        let decoded: string;

        try {
            decoded = decodeURIComponent(pathname);
        } catch {
            return null;
        }

        // 阻断路径穿越
        if (decoded.includes("\0")) {
            return null;
        }

        const normalized = decoded.replace(/^\/+/, "");
        const resolvedRoot = path.resolve(this.rootDir);
        const candidate = path.resolve(path.join(resolvedRoot, normalized));

        if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
            return null;
        }

        return candidate;
    }

    async get(pathname: string): Promise<Response | null> {
        if (!fs.existsSync(this.rootDir)) {
            return null;
        }

        const direct = this.resolve(pathname);
        if (direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
            return this.toResponse(direct);
        }

        // SPA 回退：/timeline、/admin/settings 这类前端路由都交给 index.html
        if (!/\.\w+$/.test(pathname)) {
            const indexPath = path.join(path.resolve(this.rootDir), "index.html");

            if (fs.existsSync(indexPath)) {
                return this.toResponse(indexPath);
            }
        }

        return null;
    }

    private toResponse(filePath: string): Response {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        // 带 hash 的资源可以长期缓存，index.html 必须每次校验否则发版后用户拿不到新版本
        const isHashedAsset = /\.[0-9a-f]{8,}\./i.test(path.basename(filePath));
        const cacheControl = isHashedAsset
            ? "public, max-age=31536000, immutable"
            : "no-cache";

        return new Response(new Uint8Array(data), {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(data.byteLength),
                "Cache-Control": cacheControl,
            },
        });
    }
}
