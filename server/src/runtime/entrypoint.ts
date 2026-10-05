// 容器入口
//
// 启动前先跑一次数据库迁移，再拉起 HTTP 服务。迁移是幂等的，
// 每次启动都执行安全无副作用，这样镜像升级后新表结构会自动补上。
//
// 为什么不用 CLI 的 setup-local：那个命令带有一系列配置校验（例如缺少
// SUPABASE_DATABASE_URL 时会直接退出），容器里这些校验应由编排层与
// /admin/health 负责，启动路径只做「迁移 + 启动」两件事，行为更可预期。

import * as fs from "node:fs";
import * as path from "node:path";
import { startLocalServer } from "./local-server";

async function runMigrations() {
    const dataDir = process.env.RIN_DATA_DIR || path.join(process.cwd(), "data");
    const dbFile = process.env.RIN_DB_FILE || path.join(dataDir, "rin.db");
    const sqlDir = path.join(process.cwd(), "server", "sql");

    if (!fs.existsSync(sqlDir)) {
        console.warn(`[entrypoint] migration directory not found: ${sqlDir}, skipping`);
        return;
    }

    // Supabase 模式的表结构由用户自行执行 sql-postgres/0000-init.sql 创建
    if (process.env.RIN_RUNTIME === "supabase") {
        console.log("[entrypoint] RIN_RUNTIME=supabase, skipping local SQL migration");
        return;
    }

    const { runLocalDbMigrate } = await import("../../scripts/local-db-migrate");
    runLocalDbMigrate(dbFile, sqlDir);
}

async function main() {
    try {
        await runMigrations();
    } catch (error) {
        // 迁移失败必须阻断启动：带着残缺表结构运行比直接退出更难排查
        console.error("[entrypoint] database migration failed:", error);
        process.exit(1);
    }

    await startLocalServer();
}

main().catch((error) => {
    console.error("[entrypoint] failed to start:", error);
    process.exit(1);
});
