import * as fs from "node:fs";
import * as path from "node:path";
import { parseEnv } from "../lib/env";
import { buildStorageVarsToml, resolveStorageConfig } from "../lib/storage-config";

/**
 * 校验必填项。
 *
 * 与服务端实际行为保持一致：
 * - NAME / JWT_SECRET 必填
 * -登录方式二选一：GitHub OAuth 或账号密码，两组都为空才报错
 *   （见 server/src/services/config-health.ts 的 githubReady || passwordReady）
 * - AVATAR 可为空（site.avatar 默认值为空串，见 packages/config）
 */
export function getRequiredVars(env: Record<string, string | undefined>) {
  const required: string[] = ["NAME", "JWT_SECRET"];

  const githubReady = Boolean(env.RIN_GITHUB_CLIENT_ID && env.RIN_GITHUB_CLIENT_SECRET);
  const passwordReady = Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);
  if (!githubReady && !passwordReady) {
    required.push(
      "RIN_GITHUB_CLIENT_ID + RIN_GITHUB_CLIENT_SECRET",
      "或 ADMIN_USERNAME + ADMIN_PASSWORD",
    );
  }

  required.push(...resolveStorageConfig(env).missing);

  return required;
}

export async function runSetupDev() {
  const rootDir = process.cwd();
  const envFile = path.join(rootDir, ".env.local");

  if (!fs.existsSync(envFile)) {
    console.error("❌ 错误：找不到 .env.local 文件");
    console.log("\n请执行以下步骤：");
    console.log("  1. cp .env.example .env.local");
    console.log("  2. 编辑 .env.local 填入你的配置");
    console.log("  3. 重新运行 dev 命令\n");
    process.exit(1);
  }

  const env = parseEnv(fs.readFileSync(envFile, "utf-8"));
  const storageConfig = resolveStorageConfig(env);
  const requiredVars = getRequiredVars(env);

  const missingVars = requiredVars.filter((name) => !env[name]);
  if (missingVars.length > 0) {
    console.error("❌ 错误：以下必要环境变量未设置：");
    missingVars.forEach((name) => console.error(`   - ${name}`));
    console.log(`\n当前对象存储后端：${storageConfig.provider}`);
    console.log("请编辑 .env.local 文件并添加这些配置\n");
    process.exit(1);
  }

  const wranglerContent = `#:schema node_modules/wrangler/config-schema.json
name = "${env.WORKER_NAME || "rin-server"}"
main = "server/src/_worker.ts"
compatibility_date = "2025-03-21"

[assets]
directory = "./dist/client"
binding = "ASSETS"
run_worker_first = true
not_found_handling = "single-page-application"

[triggers]
crons = ["*/20 * * * *"]

[vars]
${buildStorageVarsToml(storageConfig.vars, "")}
WEBHOOK_URL = "${env.WEBHOOK_URL || ""}"
RSS_TITLE = "${env.RSS_TITLE || "Rin Development"}"
RSS_DESCRIPTION = "${env.RSS_DESCRIPTION || "Development Environment"}"
CACHE_STORAGE_MODE = "${env.CACHE_STORAGE_MODE || "s3"}"
ADMIN_USERNAME = "${env.ADMIN_USERNAME}"
ADMIN_PASSWORD = "${env.ADMIN_PASSWORD}"

[[d1_databases]]
binding = "DB"
database_name = "${env.DB_NAME || "rin"}"
database_id = "local"

[[queues.producers]]
binding = "TASK_QUEUE"
queue = "${env.TASK_QUEUE_NAME || env.AI_SUMMARY_QUEUE_NAME || `${env.WORKER_NAME || "rin-server"}-tasks`}"

[[queues.consumers]]
queue = "${env.TASK_QUEUE_NAME || env.AI_SUMMARY_QUEUE_NAME || `${env.WORKER_NAME || "rin-server"}-tasks`}"
max_batch_size = 1
max_batch_timeout = 5
${storageConfig.provider === "r2" && env.R2_BUCKET_NAME
  ? `
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "${env.R2_BUCKET_NAME}"
preview_bucket_name = "${env.R2_BUCKET_NAME}"`
  : ""}
`;

  fs.writeFileSync(path.join(rootDir, "wrangler.toml"), wranglerContent);
  fs.writeFileSync(
    path.join(rootDir, "client", ".env"),
    `NAME=${env.NAME}
DESCRIPTION=${env.DESCRIPTION || ""}
AVATAR=${env.AVATAR}
PAGE_SIZE=${env.PAGE_SIZE || "5"}
RSS_ENABLE=${env.RSS_ENABLE || "false"}
`,
  );

  const storageSecrets = Object.entries(storageConfig.secrets)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(
    path.join(rootDir, ".dev.vars"),
    `RIN_GITHUB_CLIENT_ID=${env.RIN_GITHUB_CLIENT_ID}
RIN_GITHUB_CLIENT_SECRET=${env.RIN_GITHUB_CLIENT_SECRET}
JWT_SECRET=${env.JWT_SECRET}
${storageSecrets}
`,
  );

  console.log("✅ 已生成 wrangler.toml");
  console.log("✅ 已生成 client/.env");
  console.log("✅ 已生成 .dev.vars");
  console.log(`ℹ️  对象存储后端：${storageConfig.provider}`);
  console.log("\n🎉 配置加载完成！");
  console.log("   现在可以运行：bun run dev\n");
}
