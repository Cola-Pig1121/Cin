// 进程内任务队列与定时器
//
// 替代 Cloudflare Queues 与 Cron Triggers。Cloudflare 的队列是至少一次投递且跨请求存活，
// 进程内队列只在单进程存活，因此：
//   - 任务串行执行，天然避免 AI 摘要任务并发抢同一个 feed
//   - 重启会丢队列，所以入队时同步把状态写成 pending，重启后可由兼容任务页重新入队
//     （这也是 /admin/compat-tasks 这个页面存在的意义）

import type { QueueTaskLike, TaskQueue } from "./types";

type TaskHandler = (task: QueueTaskLike) => Promise<void>;

/**
 * 串行的内存队列。
 * 不用 setImmediate 立即执行，而是等下一个宏任务，让当前请求先返回，
 * 避免把 AI 调用的耗时算进用户请求的响应时间里。
 */
export class InProcessTaskQueue implements TaskQueue {
    private readonly pending: QueueTaskLike[] = [];
    private draining = false;
    private idleWaiters: Array<() => void> = [];

    constructor(
        private readonly handler: TaskHandler,
        private readonly options: { concurrency?: number } = {},
    ) {}

    async send(task: QueueTaskLike): Promise<void> {
        this.pending.push(task);
        queueMicrotask(() => void this.drain());
    }

    get depth(): number {
        return this.pending.length;
    }

    /** 供测试与优雅退出使用：等待队列排空 */
    async onIdle(): Promise<void> {
        if (!this.draining && this.pending.length === 0) {
            return;
        }

        await new Promise<void>((resolve) => {
            this.idleWaiters.push(resolve);
        });
    }

    private async drain(): Promise<void> {
        if (this.draining) {
            return;
        }

        this.draining = true;

        try {
            while (this.pending.length > 0) {
                const task = this.pending.shift();
                if (!task) {
                    break;
                }

                try {
                    await this.handler(task);
                } catch (error) {
                    // 单个任务失败不能拖垮整个队列，任务自身的错误已写进 feed 记录
                    console.error("[queue] task failed", task.type, error);
                }
            }
        } finally {
            this.draining = false;
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const resolve of waiters) {
                resolve();
            }
        }
    }
}

/**
 * 周期性任务。用 setInterval 替代 Cloudflare Cron Triggers。
 * 默认对齐 Cloudflare 上的每 20 分钟一次，可用 CRON_INTERVAL_MS 覆盖。
 */
export class IntervalScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly task: () => Promise<void>,
        private readonly intervalMs: number,
        private readonly name: string,
    ) {}

    start(): void {
        if (this.timer) {
            return;
        }

        this.timer = setInterval(() => {
            void this.runOnce();
        }, this.intervalMs);

        // 定时器不应阻塞进程退出
        if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
            (this.timer as { unref(): void }).unref();
        }
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runOnce(): Promise<void> {
        const startedAt = Date.now();

        try {
            await this.task();
            console.log(`[cron] ${this.name} done in ${Date.now() - startedAt}ms`);
        } catch (error) {
            console.error(`[cron] ${this.name} failed`, error);
        }
    }
}
