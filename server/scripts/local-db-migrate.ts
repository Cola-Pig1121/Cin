// 本地数据库迁移
//
// 原本通过 `wrangler d1 execute --local` 执行 SQL，那是 workerd 提供的 D1 本地实例。
// 本地部署改成直接用 bun:sqlite 操作同一个 .db 文件，SQL 文件本身不变。
//
// 版本记录沿用 info 表的 migration_version，与 Cloudflare 侧保持同一套语义，
// 因此同一份 SQL 迁移在两种运行时下的结果一致。

import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";

export const FEEDS_TABLE_EXISTS_QUERY =
  "SELECT name FROM sqlite_master WHERE type='table' AND name='feeds'";
export const FEEDS_TOP_EXISTS_QUERY = "SELECT name FROM pragma_table_info('feeds') WHERE name='top'";
export const ADD_FEEDS_TOP_COLUMN_SQL = "ALTER TABLE feeds ADD COLUMN top INTEGER DEFAULT 0 NOT NULL";

export function getMigrationFileVersion(fileName: string) {
  const match = /^(\d+)(?:\D.*)?\.sql$/i.exec(fileName.trim());
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1] || "", 10);
}

function queryOne(db: Database, sql: string): string | null {
  const row = db.query(sql).get() as { name?: string; value?: string } | null;
  if (!row) {
    return null;
  }

  return row.name ?? row.value ?? null;
}

/**
 * 迁移 0011 会给 feeds 加 top 列，先修复再跑后续 SQL，
 * 否则旧库上执行会因列已存在而报错。
 */
export function fixTopField(db: Database) {
  if (queryOne(db, FEEDS_TABLE_EXISTS_QUERY) === null) {
    console.log("Feeds table does not exist yet, skip top field check");
    return;
  }

  console.log("Checking top field on feeds table");

  if (queryOne(db, FEEDS_TOP_EXISTS_QUERY) === null) {
    console.log("Adding top field to feeds table");
    db.exec(ADD_FEEDS_TOP_COLUMN_SQL);
  } else {
    console.log("Top field already exists in feeds table");
  }
}

export function getMigrationVersion(db: Database): number {
  if (queryOne(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='info'") === null) {
    console.log("Legacy database, migration_version not exists");
    return -1;
  }

  const value = queryOne(db, "SELECT value FROM info WHERE key='migration_version'");
  if (value === null) {
    console.log("migration_version not exists");
    return -1;
  }

  console.log("migration_version:", value);
  return parseInt(value);
}

export function updateMigrationVersion(db: Database, version: number) {
  if (queryOne(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='info'") === null) {
    console.log("info table not exists, skip update migration_version");
    throw new Error("info table not exists");
  }

  db.exec(`UPDATE info SET value='${version}' WHERE key='migration_version'`);
  console.log("Updated migration_version to", version);
}

/**
 * drizzle 生成的 SQL 用 `--> statement-breakpoint` 标记语句边界，
 * bun:sqlite 的 exec 不识别这个注释，需要先拆成独立语句。
 */
export function splitSqlStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

export function runLocalDbMigrate(dbFile: string, sqlDir: string) {
  fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });

  const db = new Database(dbFile, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");

  try {
    const currentVersion = getMigrationVersion(db);
    fixTopField(db);

    const sqlFiles = fs
      .readdirSync(sqlDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .filter((file) => {
        const version = getMigrationFileVersion(file);
        return version !== null && version > currentVersion;
      })
      .sort((left, right) => (getMigrationFileVersion(left) || 0) - (getMigrationFileVersion(right) || 0));

    console.log("Migration SQL List:", sqlFiles);

    for (const file of sqlFiles) {
      const filePath = path.join(sqlDir, file);
      const statements = splitSqlStatements(fs.readFileSync(filePath, "utf-8"));

      // 每个文件一个事务：文件内任一语句失败就整体回滚，避免半迁移状态
      db.exec("BEGIN");
      try {
        for (const statement of statements) {
          db.exec(statement);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        console.error(`Failed to execute ${file}:`, error);
        process.exit(1);
      }

      console.log(`Executed ${file}`);
    }

    if (sqlFiles.length === 0) {
      console.log("No migration needed.");
    } else {
      const lastVersion = getMigrationFileVersion(sqlFiles[sqlFiles.length - 1] || "");
      if (lastVersion !== null && lastVersion > currentVersion) {
        updateMigrationVersion(db, lastVersion);
      }
    }

    console.log("Local database migration completed.");
  } finally {
    db.close();
  }
}
