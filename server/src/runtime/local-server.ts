// 本地服务器入口
//
// 替代 wrangler dev：用 Bun.serve 直接承载 Hono app，不经过 workerd。
// 路由优先级与 runtime/fetch-handler.ts 保持一致，便于两种运行时行为对齐：
//   1. /api/*        → 剥掉 /api 前缀后交给 Hono
//   2. RSS/Atom/feed → 交给 Hono
//   3. sitemap/robots/favicon → 交给 Hono
//   4. 其余          → 静态资源目录，未命中回退 index.html（SPA）
//
// 用法：bun run server/src/runtime/local-server.ts
// 或经 CLI：bun run start:local

import { getApp } from "./app-instance";
import { createLocalExecutionContext } from "./context";
import { LocalAssetProvider } from "./local-assets";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT_FEED_PATTERN = /^\/(rss\.xml|atom\.xml|rss\.json|feed\.json|feed\.xml)$/;
const APP_PUBLIC_ROUTE_PATTERN = /^\/(favicon|favicon\.ico)(?:\/|$)/;
const APP_META_ROUTE_PATTERN = /^\/(sitemap\.xml|robots\.txt)$/;

function normalizeEnv(): Record<string, string> {
    const values: Record<string, string> = {};

    // 优先读取 .env.local，其次 .env，最后用进程现有环境变量覆盖
    for (const file of [".env.local", ".env"]) {
        if (!fs.existsSync(file)) {
            continue;
        }

        for (const rawLine of fs.readFileSync(file, "utf-8").split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) {
                continue;
            }

            const separator = line.indexOf("=");
            if (separator === -1) {
                continue;
            }

            const key = line.slice(0, separator).trim();
            let value = line.slice(separator + 1).trim();

            // 去掉引号包裹
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }

            values[key] = value;
        }
    }

    return { ...values, ...(process.env as Record<string, string>) };
}

function decodePathSafe(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export async function startLocalServer(options: { port?: number } = {}) {
    const env = normalizeEnv();
    const port = options.port ?? Number(env.BACKEND_PORT) ?? 11498;

    // 运行时在 import schema 之前就要定下来，所以这里先设好
    process.env.RIN_RUNTIME = env.RIN_RUNTIME || "local";

    const dataDir = env.RIN_DATA_DIR || "./data";
    const clientDistDir = env.RIN_CLIENT_DIST || "./dist/client";
    const uploadsDir = env.RIN_UPLOAD_DIR || path.join(dataDir, "uploads");

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    const hasClientDist = fs.existsSync(path.join(clientDistDir, "index.html"));
    const assets = hasClientDist ? new LocalAssetProvider(clientDistDir) : null;

    const app = getApp();
    const executionContext = createLocalExecutionContext();

    const server = Bun.serve({
        port,
        hostname: "0.0.0.0",

        async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            const pathname = url.pathname;

            const isApi = pathname.startsWith("/api/");
            const isRootFeed = ROOT_FEED_PATTERN.test(pathname);
            const isAppPublic = APP_PUBLIC_ROUTE_PATTERN.test(pathname);
            const isMeta = APP_META_ROUTE_PATTERN.test(pathname);

            if (isApi || isRootFeed || isAppPublic || isMeta) {
                const target = isApi
                    ? new Request(
                          new URL(
                              pathname.replace(/^\/api(?=\/|$)/, "") || "/",
                              url.origin,
                          ),
                          request,
                      )
                    : request;

                try {
                    return await app.fetch(target, env as any, executionContext as any);
                } catch (error) {
                    console.error("[local] request failed", error);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            if (assets) {
                const asset = await assets.get(pathname);
                if (asset) {
                    return asset;
                }
            }

            return new Response("Not Found", { status: 404 });
        },

        error(error: Error) {
            console.error("[local] server error", error);
            return new Response("Internal Server Error", { status: 500 });
        },
    });

    console.log("");
    console.log("  Rin 本地服务已启动");
    console.log(`  ├─ API      http://127.0.0.1:${server.port}/api`);
    console.log(`  ├─ 运行时    ${env.RIN_RUNTIME || "local"}`);
    console.log(`  ├─ 数据目录  ${path.resolve(dataDir)}`);
    console.log(`  ├─ 上传目录  ${path.resolve(uploadsDir)}`);
    console.log(
        `  └─ 前端资源  ${hasClientDist ? path.resolve(clientDistDir) : "未构建（开发模式请另跑 vite）"}`,
    );
    console.log("");

    const shutdown = async () => {
        await server.stop();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return server;
}

// 直接执行时启动服务
if (import.meta.main) {
    startLocalServer().catch((error) => {
        console.error("Failed to start local server:", error);
        process.exit(1);
    });
}