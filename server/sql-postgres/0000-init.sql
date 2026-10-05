-- Supabase / Postgres 建表脚本
--
-- 与 server/sql/*.sql 的最终结构等价，但针对 Postgres 方言：
--   * serial 取代 SQLite 的隐式 rowid 自增
--   * timestamptz 取代 integer 存的 unix 秒
--   * smallint 取代 integer 存 0/1 开关（保持与 SQLite 版相同的读写语义）
--   * 唯一约束用 UNIQUE 索引实现（SQLite 的 unique() 复合约束在 PG 中同名不同义）
--
-- 用法：在 Supabase SQL Editor 中整体执行一次即可。
-- 表名、列名与 SQLite 版保持一致，业务代码与 @rin/api 契约无需改动。

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS "users" (
    "id"         SERIAL PRIMARY KEY,
    "username"   text NOT NULL,
    "openid"     text NOT NULL,
    "avatar"     text,
    "password"   text,
    "permission" smallint DEFAULT 0,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- feeds
CREATE TABLE IF NOT EXISTS "feeds" (
    "id"                 SERIAL PRIMARY KEY,
    "alias"              text,
    "title"              text,
    "summary"            text DEFAULT '' NOT NULL,
    "ai_summary"         text DEFAULT '' NOT NULL,
    "ai_summary_status"  text DEFAULT 'idle' NOT NULL,
    "ai_summary_error"   text DEFAULT '' NOT NULL,
    "content"            text NOT NULL,
    "listed"             smallint DEFAULT 1 NOT NULL,
    "draft"              smallint DEFAULT 1 NOT NULL,
    "top"                smallint DEFAULT 0 NOT NULL,
    "uid"                integer NOT NULL REFERENCES "users"("id"),
    "created_at"         timestamptz DEFAULT now() NOT NULL,
    "updated_at"         timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- moments
CREATE TABLE IF NOT EXISTS "moments" (
    "id"         SERIAL PRIMARY KEY,
    "content"    text NOT NULL,
    "uid"        integer NOT NULL REFERENCES "users"("id"),
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- visits
CREATE TABLE IF NOT EXISTS "visits" (
    "id"         SERIAL PRIMARY KEY,
    "feed_id"    integer NOT NULL REFERENCES "feeds"("id") ON DELETE CASCADE,
    "ip"         text NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- visit_stats
CREATE TABLE IF NOT EXISTS "visit_stats" (
    "feed_id"    integer PRIMARY KEY REFERENCES "feeds"("id") ON DELETE CASCADE,
    "pv"         integer DEFAULT 0 NOT NULL,
    "hll_data"   text DEFAULT '' NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- info
-- 存 migration_version 等键值配置，列名与 SQLite 版一致
CREATE TABLE IF NOT EXISTS "info" (
    "key"   text NOT NULL UNIQUE,
    "value" text NOT NULL
);

-- ---------------------------------------------------------------- friends
CREATE TABLE IF NOT EXISTS "friends" (
    "id"         SERIAL PRIMARY KEY,
    "name"       text NOT NULL,
    "desc"       text,
    "avatar"     text NOT NULL,
    "url"        text NOT NULL,
    "uid"        integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "accepted"   smallint DEFAULT 0 NOT NULL,
    "health"     text DEFAULT '' NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- comments
CREATE TABLE IF NOT EXISTS "comments" (
    "id"            SERIAL PRIMARY KEY,
    "feed_id"       integer NOT NULL REFERENCES "feeds"("id") ON DELETE CASCADE,
    "user_id"       integer REFERENCES "users"("id") ON DELETE CASCADE,
    "content"       text NOT NULL,
    "guest_name"    text DEFAULT '' NOT NULL,
    "guest_email"   text DEFAULT '' NOT NULL,
    "guest_website" text DEFAULT '' NOT NULL,
    "approved"      smallint DEFAULT 1 NOT NULL,
    "created_at"    timestamptz DEFAULT now() NOT NULL,
    "updated_at"    timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- hashtags
CREATE TABLE IF NOT EXISTS "hashtags" (
    "id"         SERIAL PRIMARY KEY,
    "name"       text NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- feed_hashtags
CREATE TABLE IF NOT EXISTS "feed_hashtags" (
    "feed_id"    integer NOT NULL REFERENCES "feeds"("id") ON DELETE CASCADE,
    "hashtag_id" integer NOT NULL REFERENCES "hashtags"("id") ON DELETE CASCADE,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- cache
CREATE TABLE IF NOT EXISTS "cache" (
    "id"         SERIAL PRIMARY KEY,
    "key"        text NOT NULL,
    "value"      text NOT NULL,
    "type"       text DEFAULT 'cache' NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 复合唯一约束：key + type（对应 SQLite 的 unique().on(key, type)）
CREATE UNIQUE INDEX IF NOT EXISTS "cache_key_type_unique" ON "cache" ("key", "type");

-- ---------------------------------------------------------------- 索引
CREATE INDEX IF NOT EXISTS "feeds_alias_idx" ON "feeds" ("alias");
CREATE INDEX IF NOT EXISTS "feeds_visibility_order_idx" ON "feeds" ("draft", "listed", "top", "created_at", "updated_at");
CREATE INDEX IF NOT EXISTS "feeds_uid_idx" ON "feeds" ("uid");
CREATE INDEX IF NOT EXISTS "visits_feed_created_at_idx" ON "visits" ("feed_id", "created_at");
CREATE INDEX IF NOT EXISTS "friends_accepted_order_idx" ON "friends" ("accepted", "sort_order", "created_at");
CREATE INDEX IF NOT EXISTS "users_openid_idx" ON "users" ("openid");
CREATE INDEX IF NOT EXISTS "comments_feed_created_at_idx" ON "comments" ("feed_id", "created_at");
CREATE INDEX IF NOT EXISTS "hashtags_name_idx" ON "hashtags" ("name");
CREATE INDEX IF NOT EXISTS "feed_hashtags_feed_hashtag_idx" ON "feed_hashtags" ("feed_id", "hashtag_id");
CREATE INDEX IF NOT EXISTS "feed_hashtags_hashtag_feed_idx" ON "feed_hashtags" ("hashtag_id", "feed_id");
CREATE INDEX IF NOT EXISTS "cache_type_key_idx" ON "cache" ("type", "key");

-- ---------------------------------------------------------------- 迁移版本
-- Supabase 侧是全新库，直接标记为最新版本（与 SQLite 侧 0012 之后一致），
-- 这样同一套 /admin/compat-tasks 逻辑在两种运行时下的判断一致。
INSERT INTO "info" ("key", "value") VALUES ('migration_version', '12')
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
