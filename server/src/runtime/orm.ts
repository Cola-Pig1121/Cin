// 统一创建数据库 ORM 实例
//
// 原本三处（fetch 容器、queue 消费者、scheduled 触发器）各自调 `drizzle(env.DB)`，
// 本地部署时 env.DB 不存在。这里抽成一个函数，按运行时选择驱动，
// 保证 worker 与本地两条路径拿到的 ORM 行为一致。

import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { resolveRuntimeKind, isLocalRuntime } from "./types";
import { createDatabase } from "./database";
import type { DB } from "../core/hono-types";

export async function createOrm(env: any): Promise<DB> {
    const runtime = resolveRuntimeKind(env);

    if (isLocalRuntime(runtime)) {
        const { getRuntimeContext } = await import("./context");
        const context = await getRuntimeContext({ kind: runtime, env });
        return context.db.orm as DB;
    }

    const schema = await import("../db/schema.sqlite");
    return drizzleD1(env.DB, { schema }) as unknown as DB;
}
