// 数据库适配
//
// Cloudflare 侧继续用 D1（drizzle-orm/d1），本地侧用 bun:sqlite，
// 两者同属 SQLite 方言，共用 schema.sqlite.ts。
//
// Supabase 侧是 Postgres，走 schema.postgres.ts，业务服务无感。
// 差异收敛在 drizzle 实例的构造上：把对应的 schema 对象传进去即可。

import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";
import type { DatabaseHandle } from "./types";

export type DatabaseKind = "d1" | "sqlite" | "postgres";

export async function createDatabase(options: {
    kind: DatabaseKind;
    binding?: D1Database;
    filePath?: string;
    connectionString?: string;
}): Promise<DatabaseHandle> {
    switch (options.kind) {
        case "d1": {
            if (!options.binding) {
                throw new Error("D1 binding (DB) is not configured");
            }
            const schema = await import("../db/schema.sqlite");
            return {
                orm: drizzleD1(options.binding, { schema }),
                raw: options.binding,
            };
        }

        case "sqlite": {
            if (!options.filePath) {
                throw new Error("SQLite file path is not configured");
            }

            const { Database: BunDatabase } = await import("bun:sqlite");
            const schema = await import("../db/schema.sqlite");
            const sqlite = new BunDatabase(options.filePath, { create: true });

            // WAL 让读写不互相阻塞；busy_timeout 避免并发写直接抛 SQLITE_BUSY
            sqlite.exec("PRAGMA journal_mode = WAL;");
            sqlite.exec("PRAGMA busy_timeout = 5000;");
            sqlite.exec("PRAGMA foreign_keys = ON;");

            return {
                orm: drizzleBun(sqlite as unknown as Database, { schema }),
                raw: sqlite,
                close: () => sqlite.close(),
            };
        }

        case "postgres": {
            if (!options.connectionString) {
                throw new Error("Postgres connection string is not configured");
            }

            const { Pool } = await import("pg");
            const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
            const schema = await import("../db/schema.postgres");

            const isLocal =
                options.connectionString.includes("localhost") ||
                options.connectionString.includes("127.0.0.1");

            const pool = new Pool({
                connectionString: options.connectionString,
                // Supabase 的连接池器（transaction pooler）不支持 prepared statement，
                // 关闭语句缓存可避免 "prepared statement already exists" 错误
                ...( { statement_cache_size: 0 } as Record<string, unknown> ),
                ssl: isLocal ? undefined : { rejectUnauthorized: false },
            });

            return {
                orm: drizzlePg(pool, { schema }),
                raw: pool,
                close: () => pool.end(),
            };
        }

        default: {
            const exhaustive: never = options.kind;
            throw new Error(`Unsupported database kind: ${String(exhaustive)}`);
        }
    }
}
