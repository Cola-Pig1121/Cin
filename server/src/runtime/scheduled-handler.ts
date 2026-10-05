import { CacheImpl } from "../utils/cache";
import { createOrm } from "./orm";

export async function handleScheduled(
  _controller: ScheduledController | null,
  env: Env,
  ctx: ExecutionContext,
) {
  const db = await createOrm(env as unknown as Record<string, any>);

  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  const { friendCrontab } = await import("../services/friends");
  const { rssCrontab } = await import("../services/rss");
  const { sitemapCrontab } = await import("../services/sitemap");

  await friendCrontab(env, ctx, db, cache, serverConfig, clientConfig);
  await rssCrontab(env, db);
  await sitemapCrontab(env, db);
}
