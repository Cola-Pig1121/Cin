import { CacheImpl } from "../utils/cache";
import { isQueueTask, FEED_AI_SUMMARY_TASK } from "../queue";
import { processFeedAISummaryTask } from "../services/feed-ai-summary";
import { clearFeedCache } from "../services/feed";
import { createOrm } from "./orm";

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
) {
  const db = await createOrm(env as unknown as Record<string, any>);
  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config", "database");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  for (const message of batch.messages) {
    const body = message.body;
    if (!isQueueTask(body)) {
      message.ack();
      continue;
    }

    switch (body.type) {
      case FEED_AI_SUMMARY_TASK:
        await processFeedAISummaryTask(
          env,
          db,
          cache,
          serverConfig,
          body.payload,
          clearFeedCache,
        );
        message.ack();
        break;
      default:
        message.ack();
        break;
    }
  }
}
