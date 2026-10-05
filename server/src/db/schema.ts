// Schema 调度器
//
// 业务服务统一从 `../db/schema` 导入表对象，这里根据 RIN_RUNTIME 决定导出
// SQLite 版还是 Postgres 版。之所以在这里转发而不是在调用点判断方言，
// 是为了让上层 19 个引用 schema 的文件完全无需改动。
//
// 切换靠环境变量，因此必须在进程启动、任何 db 访问发生之前设置好 RIN_RUNTIME。
//
// 类型说明（重要）：
// 两版 schema 的表名、列名、关系定义完全一致，运行时形状相同。但 drizzle 的
// Column 类型带 `dialect: "sqlite" | "pg"` 字面量，如果直接用三元表达式，
// 推断结果会变成 `SQLiteColumn | PgColumn` 联合类型，drizzle 的查询泛型会直接
// 报 "not assignable to type SQLiteColumn"。
//
// 解决办法是 cast 而非联合：把 Postgres 侧对象断言为 SQLite 侧的结构类型。
// 这样对外只暴露单一类型，推断完全正常；运行时仍按 RIN_RUNTIME 拿到对应实现。
// 断言集中在这一个文件里，业务代码保持干净。

import { resolveRuntimeKind } from "../runtime/types";
import type * as SQLiteSchema from "./schema.sqlite";
import * as sqliteSchema from "./schema.sqlite";
import * as postgresSchema from "./schema.postgres";

const runtime = resolveRuntimeKind({
    RIN_RUNTIME: typeof process !== "undefined" ? process.env.RIN_RUNTIME : undefined,
});

type Tables = typeof SQLiteSchema;
type TableOf<K extends keyof Tables> = Tables[K];

/** 按运行时取表；两个分支断言到同一结构类型，保证对外类型唯一 */
function pick<K extends keyof Tables>(key: K): TableOf<K> {
    return (runtime === "supabase" ? postgresSchema[key] : sqliteSchema[key]) as TableOf<K>;
}

export const feeds = pick("feeds");
export const moments = pick("moments");
export const visits = pick("visits");
export const visitStats = pick("visitStats");
export const info = pick("info");
export const friends = pick("friends");
export const users = pick("users");
export const comments = pick("comments");
export const hashtags = pick("hashtags");
export const feedHashtags = pick("feedHashtags");
export const cache = pick("cache");

export const feedsRelations = pick("feedsRelations");
export const momentsRelations = pick("momentsRelations");
export const commentsRelations = pick("commentsRelations");
export const hashtagsRelations = pick("hashtagsRelations");
export const feedHashtagsRelations = pick("feedHashtagsRelations");