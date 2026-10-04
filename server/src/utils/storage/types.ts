/**
 * 对象存储抽象层。
 *
 * Rin 支持三种对象存储后端：Cloudflare R2 binding、任意 S3 兼容服务
 * （含Cloudflare R2 的 S3 API、MinIO）、Supabase Storage。
 * 业务层只依赖 `ObjectStorage` 接口，不感知具体后端。
 */

export type StorageProviderKind = "r2" | "s3" | "supabase";

export type StorageBody = Blob | ArrayBuffer | Uint8Array | string;

/**
 * 对象存储后端契约。
 *
 * 所有方法都以「完整存储键」（不含folder 前缀）作为寻址依据，
 * folder拼接由 `storage.ts` 门面的 `putStorageObject` 负责。
 */
export interface ObjectStorage {
    /** 后端标识，用于日志、健康检查与测试断言 */
    readonly kind: StorageProviderKind;
    /** 读取对象；对象不存在时返回 null */
    get(storageKey: string): Promise<Response | null>;
    /** 读取对象元信息；对象不存在时返回 null */
    head(storageKey: string): Promise<Response | null>;
    /** 写入对象，同键覆盖 */
    put(storageKey: string, body: StorageBody, contentType?: string): Promise<void>;
    /** 生成对外可访问URL */
    publicUrl(storageKey: string, baseUrl?: string): string;
}

export function trimTrailingSlash(value: string) {
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * 分段编码存储键，保留目录结构。
 *
 * 用于 `/api/blob/*` 反代 URL。这里不做点号转义：blob 路由会用
 * `decodeURIComponent` 把键还原后再交给 provider，由provider 负责
 * URL 安全编码，避免改变既有公开 URL 形态。
 */
export function encodeStorageKey(key: string) {
    return key
        .split("/")
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

/**
 * 编码对象键的路径段，用于拼接后端请求 URL。
 *
 * `.` 与 `..` 段必须丢弃，而不是尝试编码：`new URL()` 会把 `%2E%2E`
 * 还原成 `..` 再做路径规范化，`/object/bucket/a/%2E%2E/%2E%2E/x`
 * 最终仍会变成 `/object/x`，逃出 bucket 前缀。
 *
 * Rin 的对象键本身是内容哈希或固定文件名（sitemap.xml 等），
 * 不含 `.` / `..` 段，因此这里直接丢弃是安全的。
 */
export function encodeObjectKey(key: string) {
    return key
        .split("/")
        .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

/** 构造经Worker 反代的 blob URL */
export function buildBlobUrl(storageKey: string, baseUrl?: string) {
    const path = `/api/blob/${encodeStorageKey(storageKey)}`;

    if (!baseUrl) {
        return path;
    }

    return `${trimTrailingSlash(baseUrl)}${path}`;
}

/**
 * 缺配置时统一抛 `XXX is not defined`。
 * `services/storage.ts` 依赖该子串把配置缺失映射成 500 而非 400。
 */
export function missingConfig(name: string): never {
    throw new Error(`${name} is not defined`);
}