import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parseEnv } from "../lib/env";
import {
  fixTopField,
  getMigrationFileVersion,
  getMigrationVersion,
  updateMigrationVersion,
} from "../lib/db-migration";

/**
 * 解析要操作的 D1 库名。
 *
 * 优先级：显式参数 > .env.local 的 DB_NAME > "rin"。
 * 之前 db 命令与 dev 命令各自硬编码 "rin"，与 wrangler.toml 生成的
 * database_name 不一致，导致自定义 DB_NAME 的用户查错库。
 */
export function resolveDbName(dbName?: string): string {
  if (dbName) {
    return dbName;
  }

  const envFile = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envFile)) {
    const fromEnv = parseEnv(fs.readFileSync(envFile, "utf-8")).DB_NAME;
    if (fromEnv) {
      return fromEnv;
    }
  }

  return "rin";
}

/**
 * 执行本地 D1 迁移。
 */
export async function runLocalDbMigrate(dbName?: string) {
  const sqlDir = path.join(process.cwd(), "server", "sql");
  const targetDb = resolveDbName(dbName);

  const type = "local";
  const migrationVersion = await getMigrationVersion(type, targetDb);
  // Migration 0011 indexes feeds.top, so repair the column before pending SQL runs.
  await fixTopField(type, targetDb);
  const sqlFiles = fs
    .readdirSync(sqlDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .filter((file) => {
      const version = getMigrationFileVersion(file);
      return version !== null && version > migrationVersion;
    })
    .sort((left, right) => {
      return (getMigrationFileVersion(left) || 0) - (getMigrationFileVersion(right) || 0);
    });

  console.log("migration_version:", migrationVersion, "Migration SQL List: ", sqlFiles);

  for (const file of sqlFiles) {
    const filePath = path.join(sqlDir, file);
    try {
      execSync(`bunx wrangler d1 execute ${targetDb} --local --file "${filePath}"`, { stdio: "inherit" });
      console.log(`Executed ${file}`);
    } catch (error) {
      console.error(`Failed to execute ${file}: ${error}`);
      process.exit(1);
    }
  }

  if (sqlFiles.length === 0) {
    console.log("No migration needed.");
  } else {
    const lastVersion = getMigrationFileVersion(sqlFiles[sqlFiles.length - 1] || "");
    if (lastVersion !== null && lastVersion > migrationVersion) {
      await updateMigrationVersion(type, targetDb, lastVersion);
    }
  }
}
