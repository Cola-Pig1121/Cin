// Hono context types for Rin server
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Context as HonoContext } from "hono";

/**
 * 数据库句柄类型。
 *
 * 运行时可能是 D1 / bun-sqlite / node-postgres 三种驱动之一，但它们产出的
 * drizzle 实例在业务侧用到的方法（select / insert / update / query / transaction）
 * 签名一致，且 schema 的表名、列名、关系定义在 SQLite 与 Postgres 两版中完全相同
 * （见 db/schema.sqlite.ts 与 db/schema.postgres.ts）。
 *
 * 因此这里统一用 D1 的实例类型作为"结构等价类型"：它能正确提供 db.query 关联
 * 查询与 SQL builder 的类型推断，业务代码无需任何类型断言；驱动差异只存在于
 * 运行时，不体现在类型层。
 */
export type DB = DrizzleD1Database<typeof import("../db/schema.sqlite")>;

export interface JWTUtils {
    sign(payload: any): Promise<string>;
    verify(token: string): Promise<any | null>;
}

export interface OAuth2Utils {
    generateState(): string;
    createRedirectUrl(state: string, provider: string): string;
    authorize(provider: string, code: string): Promise<{ accessToken: string } | null>;
}

export interface CacheImpl {
    get(key: string): Promise<any | null>;
    set(key: string, value: any, save?: boolean): Promise<void>;
    delete(key: string, save?: boolean): Promise<void>;
    deletePrefix(prefix: string): Promise<void>;
    getOrSet<T>(key: string, factory: () => Promise<T>): Promise<T>;
    getOrDefault<T>(key: string, defaultValue: T): Promise<T>;
    getBySuffix(suffix: string): Promise<any[]>;
    all(): Promise<Map<string, any>>;
    save(): Promise<void>;
    clear(): Promise<void>;
}

export interface Variables {
    db: DB;
    cache: CacheImpl;
    serverConfig: CacheImpl;
    clientConfig: CacheImpl;
    jwt: JWTUtils;
    oauth2?: OAuth2Utils;
    uid?: number;
    admin: boolean;
    username?: string;
    env: Env;
}

export type AppContext = HonoContext<{
    Bindings: Env;
    Variables: Variables;
}>;