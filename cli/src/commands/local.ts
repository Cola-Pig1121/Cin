// 本地部署命令
//
// 与 dev（走 wrangler + workerd）并列，提供一条不依赖 Cloudflare 工具链的启动路径：
//   start        启动本地后端（bun:sqlite + 本地磁盘或 S3）
//   start:client 同时启动后端与 Vite 开发服务器
//   setup        校验本地配置并初始化数据库
//
// 前后端沿用分离模式：后端监听 11498，Vite 通过 proxy 把 /api 转发过来。

import { parseArgs } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Subprocess } from "bun";
import { checkPort } from "../lib/network";
import { parseEnv } from "../lib/env";

const bunExec = process.execPath;

interface LocalOptions {
  port: number;
  runtime: "local" | "supabase";
  client: boolean;
  clientPort: number;
  skipMigrate: boolean;
}

function readEnvFile(rootDir: string): Record<string, string> {
  const envFile = path.join(rootDir, ".env.local");

  if (!fs.existsSync(envFile)) {
    return {};
  }

  return parseEnv(fs.readFileSync(envFile, "utf-8"));
}

function resolveOptions(rawArgs: string[]): LocalOptions {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      port: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      client: { type: "boolean" },
      "skip-migrate": { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  const env = readEnvFile(process.cwd());
  const runtime = values.runtime === "supabase" || env.RIN_RUNTIME === "supabase" ? "supabase" : "local";

  return {
    port: Number(values.port) || Number(env.BACKEND_PORT) || 11498,
    runtime,
    client: Boolean(values.client),
    clientPort: Number(values.port) ? Number(values.port) + 100 : 11499,
    skipMigrate: Boolean(values["skip-migrate"]),
  };
}

/** 运行数据库迁移：本地 SQLite 用 bun:sqlite，Supabase 由用户自行执行建表脚本 */
async function runMigration(options: LocalOptions) {
  const env = readEnvFile(process.cwd());

  if (options.runtime === "supabase") {
    const initSql = path.join(process.cwd(), "server", "sql-postgres", "0000-init.sql");
    console.log("ℹ️  Supabase 模式：请在 SQL Editor 中执行一次建表脚本");
    console.log(`   ${initSql}`);
    console.log("   然后重新运行本命令。\n");
    return;
  }

  const dataDir = env.RIN_DATA_DIR || path.join(process.cwd(), "data");
  const dbFile = env.RIN_DB_FILE || path.join(dataDir, "rin.db");
  const sqlDir = path.join(process.cwd(), "server", "sql");

  // cli/src/commands/ → 仓库根目录
  const { runLocalDbMigrate } = await import("../../../server/scripts/local-db-migrate");
  runLocalDbMigrate(dbFile, sqlDir);
}

/** 启动本地配置检查 */
function checkLocalConfig(options: LocalOptions) {
  const rootDir = process.cwd();
  const envFile = path.join(rootDir, ".env.local");

  if (!fs.existsSync(envFile)) {
    console.log("ℹ️  未找到 .env.local，将使用内置默认值启动。");
    console.log("   需要自定义配置时：cp .env.example .env.local\n");
  }

  const env = readEnvFile(rootDir);

  if (!env.JWT_SECRET) {
    console.warn("⚠️  未设置 JWT_SECRET，登录与后台会话校验会失败。");
    console.warn("   请在 .env.local 中加入：JWT_SECRET=<任意长字符串>\n");
  }

  if (options.runtime === "supabase") {
    if (!env.SUPABASE_DATABASE_URL) {
      console.error("❌ Supabase 模式需要 SUPABASE_DATABASE_URL");
      console.error("   在 .env.local 中加入 Supabase 的连接串（Project Settings → Database → Connection string）\n");
      process.exit(1);
    }

    console.log("ℹ️  数据存储：Supabase Postgres");
  } else {
    console.log("ℹ️  数据存储：本地 SQLite");
  }

  // 存储后端：有 S3_ENDPOINT 走 S3（Supabase / R2 / MinIO），否则用本地磁盘
  if (env.S3_ENDPOINT) {
    console.log(`ℹ️  文件存储：S3 协议 (${env.S3_ENDPOINT})`);
  } else {
    console.log("ℹ️  文件存储：本地磁盘");
  }
}

function registerSignalHandlers(processes: Subprocess[]) {
  const stopAll = () => {
    for (const child of processes) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);
}

export async function runStartCommand(rawArgs: string[]) {
  const options = resolveOptions(rawArgs);

  if (!(await checkPort(options.port))) {
    throw new Error(`Port ${options.port} is already in use`);
  }

  checkLocalConfig(options);

  if (!options.skipMigrate) {
    await runMigration(options);
  }

  const children: Subprocess[] = [];

  // RIN_RUNTIME 必须在启动前设好：schema 在模块加载时按它定型
  const env = {
    ...process.env,
    ...readEnvFile(process.cwd()),
    RIN_RUNTIME: options.runtime,
    BACKEND_PORT: String(options.port),
  };

  const server = Bun.spawn([bunExec, "server/src/runtime/local-server.ts"], {
    cwd: process.cwd(),
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(server);

  if (options.client) {
    if (!(await checkPort(options.clientPort))) {
      throw new Error(`Port ${options.clientPort} is already in use`);
    }

    console.log(`  前端开发服务器：http://127.0.0.1:${options.clientPort}\n`);

    const client = Bun.spawn(
      [bunExec, "x", "vite", "--host", "0.0.0.0", "--port", String(options.clientPort), "--strictPort"],
      {
        cwd: path.join(process.cwd(), "client"),
        env: {
          ...env,
          RIN_SERVER_PORT: String(options.port),
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    children.push(client);
  }

  registerSignalHandlers(children);

  // 任一子进程退出即整体退出，避免留下孤儿进程
  const exitCodes = await Promise.all(children.map((child) => child.exited));
  const failed = exitCodes.find((code) => code !== 0);

  for (const child of children) {
    child.kill("SIGTERM");
  }

  if (failed !== undefined) {
    process.exit(failed);
  }
}

export async function runSetupLocalCommand(rawArgs: string[]) {
  const options = resolveOptions(rawArgs);

  checkLocalConfig(options);
  await runMigration(options);

  console.log("\n✅ 本地环境准备完成");
  console.log("   启动服务：bun run start:local");
  console.log("   开发模式：bun run start:local:client\n");
}
