// 运行时容器
//
// 把数据库、对象存储、任务队列、静态资源四类平台能力组装成一个上下文，
// 业务层只从这里取依赖，不再直接触碰 Cloudflare 绑定。
//
// cloudflare 运行时：直接复用 workerd 注入的 env，不缓存（每次请求 env 都不同）
// local / supabase：在进程内创建单例，跨请求复用

import * as fs from "node:fs";
import type { AssetProvider, DatabaseHandle, StorageBackend, TaskQueue } from "./types";
import { createDatabase, type DatabaseKind } from "./database";
import { LocalAssetProvider } from "./local-assets";
import { InProcessTaskQueue, IntervalScheduler } from "./local-queue";
import { LocalFileStorage } from "./local-storage";
import { processFeedAISummaryTask } from "../services/feed-ai-summary";
import { clearFeedCache } from "../services/feed";
import { CacheImpl } from "../utils/cache";
import { isQueueTask, FEED_AI_SUMMARY_TASK } from "../queue";

export interface RuntimeContext {
    kind: "cloudflare" | "local" | "supabase";
    db: DatabaseHandle;
    storage: StorageBackend | null;
    queue: TaskQueue | null;
    assets: AssetProvider | null;
    scheduler: IntervalScheduler | null;
    stop(): Promise<void>;
}

export function resolveDatabaseKind(kind: RuntimeContext["kind"]): DatabaseKind {
    if (kind === "supabase") {
        return "postgres";
    }
    if (kind === "local") {
        return "sqlite";
    }
    return "d1";
}

interface ResolvedPaths {
    dataDir: string;
    uploadsDir: string;
    clientDistDir: string;
    dbFile: string;
}

function resolveLocalPaths(env: any): ResolvedPaths {
    const dataDir = env.RIN_DATA_DIR || "./data";
    const uploadsDir = env.RIN_UPLOAD_DIR || `${dataDir}/uploads`;
    const clientDistDir = env.RIN_CLIENT_DIST || "./dist/client";
    const dbFile = env.RIN_DB_FILE || `${dataDir}/rin.db`;

    return { dataDir, uploadsDir, clientDistDir, dbFile };
}

/**
 * 存储后端选择顺序：
 *   1. RIN_STORAGE_BACKEND=local → 本地磁盘
 *   2. RIN_STORAGE_BACKEND=s3    → S3 协议（Supabase / R2 / MinIO）
 *   3. 未指定时，有 S3_ENDPOINT 用 S3，否则用本地磁盘
 * 这样零配置也能跑起来，同时显式配置永远优先。
 */
function shouldUseLocalFiles(env: any) {
    const explicit = (env.RIN_STORAGE_BACKEND || "").trim().toLowerCase();

    if (explicit === "local") {
        return true;
    }
    if (explicit === "s3") {
        return false;
    }

    return !env.S3_ENDPOINT;
}

let cachedContext: RuntimeContext | null = null;
let cachedKind: string | null = null;

export async function getRuntimeContext(options: {
    kind: RuntimeContext["kind"];
    env: any;
}): Promise<RuntimeContext> {
    if (options.kind === "cloudflare") {
        return createCloudflareContext(options.env);
    }

    if (cachedContext && cachedKind === options.kind) {
        return cachedContext;
    }

    // 运行时切换时先释放上一个（测试里会反复切）
    if (cachedContext) {
        await cachedContext.stop();
    }

    cachedContext = await createLocalContext(options.kind, options.env);
    cachedKind = options.kind;

    return cachedContext;
}

/** 供测试重置单例 */
export async function resetRuntimeContext() {
    if (cachedContext) {
        await cachedContext.stop();
    }
    cachedContext = null;
    cachedKind = null;
}

async function createLocalContext(
    kind: "local" | "supabase",
    env: any,
): Promise<RuntimeContext> {
    const paths = resolveLocalPaths(env);
    fs.mkdirSync(paths.dataDir, { recursive: true });

    const db = await createDatabase({
        kind: resolveDatabaseKind(kind),
        filePath: kind === "local" ? paths.dbFile : undefined,
        connectionString:
            kind === "supabase" ? env.SUPABASE_DATABASE_URL || env.DATABASE_URL : undefined,
    });

    const storage = shouldUseLocalFiles(env)
        ? new LocalFileStorage(paths.uploadsDir)
        : null;

    const orm = db.orm;
    const clientConfig = new CacheImpl(orm, env, "client.config", "database");
    const cache = new CacheImpl(orm, env, "cache", "database", clientConfig);
    const serverConfig = new CacheImpl(orm, env, "server.config", "database");

    const queue = new InProcessTaskQueue(async (task) => {
        if (!isQueueTask(task)) {
            return;
        }

        if (task.type === FEED_AI_SUMMARY_TASK) {
            await processFeedAISummaryTask(
                env,
                orm,
                cache,
                serverConfig,
                task.payload,
                clearFeedCache,
            );
        }
    });

    // 对齐 Cloudflare 上的 */20 * * * *，可用 CRON_INTERVAL_MS 覆盖
    const intervalMs = Number(env.CRON_INTERVAL_MS) || 20 * 60 * 1000;
    const scheduler = new IntervalScheduler(
        async () => {
            const { friendCrontab } = await import("../services/friends");
            const { rssCrontab } = await import("../services/rss");
            const { sitemapCrontab } = await import("../services/sitemap");

            await friendCrontab(
                env,
                createLocalExecutionContext(),
                orm,
                cache,
                serverConfig,
                clientConfig,
            );
            await rssCrontab(env, orm);
            await sitemapCrontab(env, orm);
        },
        intervalMs,
        "scheduled-tasks",
    );

    scheduler.start();

    const assets = fs.existsSync(paths.clientDistDir)
        ? new LocalAssetProvider(paths.clientDistDir)
        : null;

    return {
        kind,
        db,
        storage,
        queue,
        assets,
        scheduler,
        stop: async () => {
            scheduler.stop();
            await queue.onIdle();
            db.close?.();
        },
    };
}

function createCloudflareContext(env: any): RuntimeContext {
    return {
        kind: "cloudflare",
        // cloudflare 路径的 db 由 hono-middleware 懒加载（D1 是异步绑定），
        // 这里只暴露 raw 句柄，实际 orm 由 createDatabase 在请求内构造
        db: {
            orm: null,
            raw: env.DB,
        },
        storage: null,
        queue: null,
        assets: env.ASSETS ? wrapAssetsBinding(env.ASSETS) : null,
        scheduler: null,
        stop: async () => {},
    };
}

function wrapAssetsBinding(assets: Fetcher): AssetProvider {
    return {
        async get(pathname: string) {
            try {
                const url = new URL(pathname, "https://assets.local");
                const response = await assets.fetch(new Request(url));

                return response.status === 200 ? response : null;
            } catch {
                return null;
            }
        },
    };
}

/**
 * Cloudflare 的 ExecutionContext 只有 waitUntil，本地实现成"登记后立即返回"，
 * 让 friends 的健康检查等逻辑在两种运行时下语义一致。
 */
export function createLocalExecutionContext() {
    const pending: Promise<unknown>[] = [];

    return {
        waitUntil(promise: Promise<unknown>) {
            pending.push(
                Promise.resolve(promise).catch((error) => {
                    console.error("[waitUntil] background task failed", error);
                }),
            );
        },
        passThroughOnException() {},
        async drain() {
            await Promise.allSettled(pending);
        },
    };
}
