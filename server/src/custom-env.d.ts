import type { QueueTask } from "./queue";

declare global {
  interface Env {
    TASK_QUEUE?: Queue<QueueTask>;
    R2_BUCKET?: R2Bucket;
    /** 站点公开访问地址（可选）。未设置时 sitemap/robots 回退到请求来源 origin */
    FRONTEND_URL?: string;

    // ---- 本地 / Supabase 运行时配置（Cloudflare 部署时不生效）----

    /**
     * 运行时选择：cloudflare（默认）| local | supabase。
     * 必须在进程启动、任何 db 访问之前设置好，因为 schema 在模块加载时就要定型。
     */
    RIN_RUNTIME?: string;
    /** 本地数据根目录，默认 ./data */
    RIN_DATA_DIR?: string;
    /** 本地 SQLite 文件路径，默认 ${RIN_DATA_DIR}/rin.db */
    RIN_DB_FILE?: string;
    /** 本地磁盘存储目录，默认 ${RIN_DATA_DIR}/uploads */
    RIN_UPLOAD_DIR?: string;
    /** 前端构建产物目录，默认 ./dist/client */
    RIN_CLIENT_DIST?: string;
    /** 存储后端：local | s3。未指定时按 S3_ENDPOINT 是否存在自动判断 */
    RIN_STORAGE_BACKEND?: string;
    /** 定时任务间隔（毫秒），默认 20 分钟，对齐 Cloudflare 的 cron 配置 */
    CRON_INTERVAL_MS?: string;
    /** Supabase Postgres 连接串 */
    SUPABASE_DATABASE_URL?: string;
  }
}

export {};
