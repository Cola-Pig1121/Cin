import { logger } from "./lib/logger";
import { runDbCommand } from "./commands/db";
import { runDeployCommand } from "./commands/deploy";
import { runDevCommand } from "./commands/dev";
import { runReleaseCommand } from "./commands/release";
import { runSetupDev } from "./tasks/setup-dev";
import { runSeoRender } from "./tasks/seo-render";
import { runSetupLocalCommand, runStartCommand } from "./commands/local";

function printHelp() {
  console.log(`Rin CLI

Cloudflare 运行时:
  dev                启动 wrangler + vite（workerd）
  deploy             部署到 Cloudflare
  setup-dev          生成 wrangler.toml 等配置

本地运行时:
  start              启动本地后端（SQLite / Supabase，无需 wrangler）
  start --client     同时启动后端与 Vite 开发服务器
  setup-local        校验配置并初始化本地数据库
  start -r supabase  以 Supabase 作为数据与文件后端

通用:
  db migrate
  db fix-top-field
  release <version>
  seo-render
`);
}

export async function runCli(rawArgs: string[]) {
  const args = [...rawArgs];
  const commandIndex = args.findIndex((arg) => !arg.startsWith("-"));
  const command = commandIndex >= 0 ? args[commandIndex] : null;
  const cmdArgs = commandIndex >= 0 ? [...args.slice(0, commandIndex), ...args.slice(commandIndex + 1)] : args;

  if (!command || args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }

  if (args.includes("-v") || args.includes("--version")) {
    console.log("rin-cli v1.0.0");
    return;
  }

  switch (command) {
    case "dev":
      await runDevCommand(cmdArgs);
      return;
    case "deploy":
      await runDeployCommand(cmdArgs);
      return;
    case "start":
      await runStartCommand(cmdArgs);
      return;
    case "setup-local":
      await runSetupLocalCommand(cmdArgs);
      return;
    case "db":
      await runDbCommand(cmdArgs);
      return;
    case "release":
      await runReleaseCommand(cmdArgs);
      return;
    case "setup-dev":
      await runSetupDev();
      return;
    case "seo-render":
      await runSeoRender();
      return;
    default:
      logger.error(`Unknown command: ${command}`);
      printHelp();
      throw new Error(`Unknown command: ${command}`);
  }
}
