// 运行时抽象层
//
// Rin 原本只跑在 Cloudflare Workers 上，数据库、对象存储、任务队列都直接依赖
// Cloudflare 的绑定。本地部署需要在没有 workerd 的情况下跑起同一套业务代码，
// 因此把平台能力收敛到下面这些接口，由 cloudflare / local / supabase 三套实现提供。
//
// 选择运行时的唯一开关是 RIN_RUNTIME，未设置时默认 cloudflare（保持既有部署行为）。

/** 任务队列的最小能力，屏蔽 Cloudflare Queues 与进程内队列的差异 */
export interface TaskQueue {
    send(task: QueueTaskLike): Promise<void>;
}

/** 队列任务的通用结构，运行时无关 */
export interface QueueTaskLike {
    type: string;
    payload: any;
}

/**
 * 存储后端。key 是形如 `images/foo.png` 的对象键，不带开头斜杠。
 * publicBaseUrl 为空时，调用方应回退到 /api/blob/<key> 形式的本地读取。
 */
export interface StorageBackend {
    get(key: string): Promise<StoredObject | null>;
    head(key: string): Promise<StoredObject | null>;
    put(
        key: string,
        body: Blob | ArrayBuffer | Uint8Array | string,
        contentType?: string,
    ): Promise<void>;
    delete(key: string): Promise<void>;
}

export interface StoredObject {
    body: ReadableStream | Uint8Array | null;
    size: number;
    contentType?: string;
    etag?: string;
    uploaded: Date;
    lastModified?: Date;
}

/** 数据库句柄。SQLite 与 Postgres 的驱动类型不同，这里只暴露业务真正用到的能力 */
export interface DatabaseHandle {
    /** drizzle 实例，交给业务服务使用 */
    readonly orm: any;
    /** 原始连接，供迁移与调试使用 */
    readonly raw: unknown;
    close?(): void;
}

/** 静态资源读取器，用于替代 Workers 的 ASSETS 绑定 */
export interface AssetProvider {
    /** 按路径返回资源，不存在时返回 null */
    get(pathname: string): Promise<Response | null>;
}

export type RuntimeKind = "cloudflare" | "local" | "supabase";

export function resolveRuntimeKind(env: { RIN_RUNTIME?: string }): RuntimeKind {
    const value = (env.RIN_RUNTIME || "").trim().toLowerCase();

    if (value === "local" || value === "supabase") {
        return value;
    }

    return "cloudflare";
}

export function isLocalRuntime(kind: RuntimeKind) {
    return kind === "local" || kind === "supabase";
}
