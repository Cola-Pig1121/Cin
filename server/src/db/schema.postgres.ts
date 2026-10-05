// Postgres / Supabase 版 schema
//
// 与 schema.sqlite.ts 保持表名、列名、关系定义完全一致，业务服务代码无需区分方言。
// 差异集中在三类：
//   1. 自增主键：SQLite 的 integer primary key 是隐式 rowid，PG 必须用 serial/identity
//   2. 时间戳：SQLite 用 integer 存 unix 秒，PG 直接用 timestamptz
//   3. 开关字段：SQLite 用 integer 0/1，PG 用 boolean
//      为让上层 `eq(feeds.draft, 1)` 这类判断继续工作，PG 侧保留 smallint 而非 boolean，
//      这样跨方言的查询语句可以完全复用，不需要为 PG 写第二套条件。

import { relations, sql } from "drizzle-orm";
import {
    boolean,
    index,
    integer,
    pgTable,
    serial,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
} from "drizzle-orm/pg-core";

const created_at = timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull();
const updated_at = timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull();

export const users = pgTable(
    "users",
    {
        id: serial("id").primaryKey(),
        username: text("username").notNull(),
        openid: text("openid").notNull(),
        avatar: text("avatar"),
        password: text("password"),
        permission: smallint("permission").default(0),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        openidIdx: index("users_openid_idx").on(table.openid),
    }),
);

export const feeds = pgTable(
    "feeds",
    {
        id: serial("id").primaryKey(),
        alias: text("alias"),
        title: text("title"),
        summary: text("summary").default("").notNull(),
        ai_summary: text("ai_summary").default("").notNull(),
        ai_summary_status: text("ai_summary_status").default("idle").notNull(),
        ai_summary_error: text("ai_summary_error").default("").notNull(),
        content: text("content").notNull(),
        listed: smallint("listed").default(1).notNull(),
        draft: smallint("draft").default(1).notNull(),
        top: smallint("top").default(0).notNull(),
        uid: integer("uid")
            .references(() => users.id)
            .notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        aliasIdx: index("feeds_alias_idx").on(table.alias),
        visibilityOrderIdx: index("feeds_visibility_order_idx").on(
            table.draft,
            table.listed,
            table.top,
            table.createdAt,
            table.updatedAt,
        ),
        uidIdx: index("feeds_uid_idx").on(table.uid),
    }),
);

export const moments = pgTable("moments", {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    uid: integer("uid")
        .references(() => users.id)
        .notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
});

export const visits = pgTable(
    "visits",
    {
        id: serial("id").primaryKey(),
        feedId: integer("feed_id")
            .references(() => feeds.id, { onDelete: "cascade" })
            .notNull(),
        ip: text("ip").notNull(),
        createdAt: created_at,
    },
    (table) => ({
        feedCreatedAtIdx: index("visits_feed_created_at_idx").on(table.feedId, table.createdAt),
    }),
);

export const visitStats = pgTable("visit_stats", {
    feedId: integer("feed_id")
        .references(() => feeds.id, { onDelete: "cascade" })
        .notNull()
        .primaryKey(),
    pv: integer("pv").default(0).notNull(),
    hllData: text("hll_data").default("").notNull(),
    updatedAt: updated_at,
});

export const info = pgTable("info", {
    key: text("key").notNull().unique(),
    value: text("value").notNull(),
});

export const friends = pgTable(
    "friends",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        desc: text("desc"),
        avatar: text("avatar").notNull(),
        url: text("url").notNull(),
        uid: integer("uid")
            .references(() => users.id, { onDelete: "cascade" })
            .notNull(),
        accepted: smallint("accepted").default(0).notNull(),
        health: text("health").default("").notNull(),
        sort_order: integer("sort_order").default(0).notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        acceptedOrderIdx: index("friends_accepted_order_idx").on(
            table.accepted,
            table.sort_order,
            table.createdAt,
        ),
    }),
);

export const comments = pgTable(
    "comments",
    {
        id: serial("id").primaryKey(),
        feedId: integer("feed_id")
            .references(() => feeds.id, { onDelete: "cascade" })
            .notNull(),
        userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
        content: text("content").notNull(),
        guestName: text("guest_name").default("").notNull(),
        guestEmail: text("guest_email").default("").notNull(),
        guestWebsite: text("guest_website").default("").notNull(),
        approved: smallint("approved").default(1).notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        feedCreatedAtIdx: index("comments_feed_created_at_idx").on(table.feedId, table.createdAt),
    }),
);

export const hashtags = pgTable(
    "hashtags",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        nameIdx: index("hashtags_name_idx").on(table.name),
    }),
);

export const feedHashtags = pgTable(
    "feed_hashtags",
    {
        feedId: integer("feed_id")
            .references(() => feeds.id, { onDelete: "cascade" })
            .notNull(),
        hashtagId: integer("hashtag_id")
            .references(() => hashtags.id, { onDelete: "cascade" })
            .notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        feedHashtagIdx: index("feed_hashtags_feed_hashtag_idx").on(table.feedId, table.hashtagId),
        hashtagFeedIdx: index("feed_hashtags_hashtag_feed_idx").on(table.hashtagId, table.feedId),
    }),
);

export const cache = pgTable(
    "cache",
    {
        id: serial("id").primaryKey(),
        key: text("key").notNull(),
        value: text("value").notNull(),
        type: text("type").default("cache").notNull(),
        createdAt: created_at,
        updatedAt: updated_at,
    },
    (table) => ({
        keyTypeUnique: uniqueIndex("cache_key_type_unique").on(table.key, table.type),
        typeKeyIdx: index("cache_type_key_idx").on(table.type, table.key),
    }),
);

export const feedsRelations = relations(feeds, ({ many, one }) => ({
    hashtags: many(feedHashtags),
    user: one(users, {
        fields: [feeds.uid],
        references: [users.id],
    }),
    comments: many(comments),
}));

export const momentsRelations = relations(moments, ({ one }) => ({
    user: one(users, {
        fields: [moments.uid],
        references: [users.id],
    }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
    feed: one(feeds, {
        fields: [comments.feedId],
        references: [feeds.id],
    }),
    user: one(users, {
        fields: [comments.userId],
        references: [users.id],
    }),
}));

export const hashtagsRelations = relations(hashtags, ({ many }) => ({
    feeds: many(feedHashtags),
}));

export const feedHashtagsRelations = relations(feedHashtags, ({ one }) => ({
    feed: one(feeds, {
        fields: [feedHashtags.feedId],
        references: [feeds.id],
    }),
    hashtag: one(hashtags, {
        fields: [feedHashtags.hashtagId],
        references: [hashtags.id],
    }),
}));
