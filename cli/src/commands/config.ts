import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { logger } from "../lib/logger";
import { maskEnvValue, readEnvFile, unquoteEnvValue, upsertEnvLines } from "../lib/env-file";

type ConfigField = {
  key: string;
  /** 问句（英文，与 CLI 输出惯例一致） */
  prompt: string;
  /** 是否机密值：输入不回显 */
  secret?: boolean;
  /** 未配置时的提示默认值（不写盘） */
  fallback?: string;
};

// 现阶段覆盖 publish 与本地 DB 命令所需的环境变量；
// publish 的 API 地址在 .env.local 里，账号密码同样存放于此。
const FIELDS: ConfigField[] = [
  { key: "RIN_PUBLISH_API", prompt: "Blog API base URL (e.g. https://blog.example.com/api)" },
  { key: "ADMIN_USERNAME", prompt: "Admin username for the blog" },
  { key: "ADMIN_PASSWORD", prompt: "Admin password (input hidden)", secret: true },
  { key: "DB_NAME", prompt: "Local D1 database name", fallback: "rin" },
];

const envPath = path.resolve(process.cwd(), ".env.local");

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

/** 机密值输入：raw 模式逐字符读取，回显 *，不支持粘贴多行 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    let value = "";
    const onChar = (chunk: Buffer) => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.removeListener("data", onChar);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\x7f" || ch === "\b") {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
          continue;
        }
        // 忽略控制字符
        if (ch < " ") continue;
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onChar);
  });
}

function printHelp() {
  console.log(`Configure environment variables in .env.local (repo root).

Usage:
  rin config              # interactive walkthrough, Enter keeps current value
  rin config --list       # show current values (secrets masked)

Covered keys: ${FIELDS.map((f) => f.key).join(", ")}`);
}

export async function runConfigCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const current = readEnvFile(envPath);

  if (values.list) {
    for (const field of FIELDS) {
      const value = unquoteEnvValue(current[field.key]) || "(not set)";
      console.log(`${field.key}=${field.secret ? maskEnvValue(unquoteEnvValue(current[field.key])) : value}`);
    }
    return;
  }

  if (!process.stdin.isTTY) {
    logger.error("rin config needs an interactive terminal. Use 'rin config --list' to inspect values.");
    return;
  }

  console.log(`Configuring ${envPath}\nPress Enter to keep the current value.\n`);

  const next: Record<string, string> = {};
  for (const field of FIELDS) {
    const existing = unquoteEnvValue(current[field.key]);
    const shown = field.secret ? maskEnvValue(existing) : existing || (field.fallback ? `(${field.fallback})` : "");
    const answer = field.secret
      ? await askHidden(`${field.prompt} [${shown}]: `)
      : (await ask(`${field.prompt} [${shown}]: `)).trim();

    // 回车 = 保留现值；显式输入空内容且本无配置时，写 fallback（机密值除外）
    if (answer === "") {
      if (existing) next[field.key] = existing;
      else if (field.fallback && !field.secret) next[field.key] = field.fallback;
      continue;
    }
    next[field.key] = answer;
  }

  const before = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const edit = upsertEnvLines(before, next);

  if (edit.updated.length === 0 && edit.appended.length === 0) {
    console.log("\nNo changes.");
    return;
  }

  fs.writeFileSync(envPath, edit.content, "utf8");
  if (edit.updated.length > 0) console.log(`\nUpdated: ${edit.updated.join(", ")}`);
  if (edit.appended.length > 0) console.log(`Added: ${edit.appended.join(", ")}`);
  console.log(`Saved to ${envPath}`);
}
