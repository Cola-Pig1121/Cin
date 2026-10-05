import { describe, expect, test } from "bun:test";
import { InProcessTaskQueue, IntervalScheduler } from "../local-queue";
import { resolveRuntimeKind, isLocalRuntime } from "../types";

describe("resolveRuntimeKind", () => {
  test("未设置时默认 cloudflare", () => {
    expect(resolveRuntimeKind({})).toBe("cloudflare");
    expect(resolveRuntimeKind({ RIN_RUNTIME: "" })).toBe("cloudflare");
  });

  test("识别 local 与 supabase", () => {
    expect(resolveRuntimeKind({ RIN_RUNTIME: "local" })).toBe("local");
    expect(resolveRuntimeKind({ RIN_RUNTIME: "supabase" })).toBe("supabase");
  });

  test("忽略大小写与首尾空格", () => {
    expect(resolveRuntimeKind({ RIN_RUNTIME: "  LOCAL " })).toBe("local");
    expect(resolveRuntimeKind({ RIN_RUNTIME: "Supabase" })).toBe("supabase");
  });

  test("未知值回退到 cloudflare，避免误伤既有部署", () => {
    expect(resolveRuntimeKind({ RIN_RUNTIME: "whatever" })).toBe("cloudflare");
  });

  test("isLocalRuntime 覆盖两种非 Cloudflare 运行时", () => {
    expect(isLocalRuntime("local")).toBe(true);
    expect(isLocalRuntime("supabase")).toBe(true);
    expect(isLocalRuntime("cloudflare")).toBe(false);
  });
});

describe("InProcessTaskQueue", () => {
  test("按入队顺序串行执行任务", async () => {
    const order: string[] = [];
    const queue = new InProcessTaskQueue(async (task) => {
      order.push(`start:${task.payload.id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${task.payload.id}`);
    });

    await queue.send({ type: "t", payload: { id: 1 } });
    await queue.send({ type: "t", payload: { id: 2 } });
    await queue.onIdle();

    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  test("单个任务抛错不影响后续任务", async () => {
    const done: number[] = [];
    const queue = new InProcessTaskQueue(async (task) => {
      if (task.payload.id === 1) {
        throw new Error("boom");
      }
      done.push(task.payload.id);
    });

    await queue.send({ type: "t", payload: { id: 1 } });
    await queue.send({ type: "t", payload: { id: 2 } });
    await queue.onIdle();

    expect(done).toEqual([2]);
  });

  test("send 立即返回，不等待任务完成", async () => {
    let finished = false;
    const queue = new InProcessTaskQueue(async () => {
      await new Promise((r) => setTimeout(r, 30));
      finished = true;
    });

    await queue.send({ type: "t", payload: {} });
    // send 已返回，任务仍在后台执行
    expect(finished).toBe(false);

    await queue.onIdle();
    expect(finished).toBe(true);
  });

  test("队列空闲时 onIdle 立即返回", async () => {
    const queue = new InProcessTaskQueue(async () => {});
    await queue.onIdle();
  });

  test("depth 反映待处理数量", async () => {
    const queue = new InProcessTaskQueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await queue.send({ type: "t", payload: {} });
    await queue.send({ type: "t", payload: {} });

    expect(queue.depth).toBeGreaterThan(0);
    await queue.onIdle();
    expect(queue.depth).toBe(0);
  });
});

describe("IntervalScheduler", () => {
  test("runOnce 执行任务", async () => {
    let count = 0;
    const scheduler = new IntervalScheduler(async () => {
      count++;
    }, 1000, "test");

    await scheduler.runOnce();
    expect(count).toBe(1);
  });

  test("任务抛错不会向外传播", async () => {
    const scheduler = new IntervalScheduler(async () => {
      throw new Error("cron failed");
    }, 1000, "test");

    await scheduler.runOnce();
  });

  test("start 幂等，stop 可重复调用", async () => {
    const scheduler = new IntervalScheduler(async () => {}, 50, "test");

    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });

  test("到达间隔后重复执行，并在 stop 后停止", async () => {
    let count = 0;
    const scheduler = new IntervalScheduler(async () => {
      count++;
    }, 20, "test");

    scheduler.start();
    await new Promise((r) => setTimeout(r, 70));
    scheduler.stop();

    const seen = count;
    expect(seen).toBeGreaterThanOrEqual(2);

    // stop 之后计数不再增长
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(seen);
  });
});
