// 本地文件系统存储
//
// 替代 Cloudflare R2 / S3，供本地部署使用。文件以对象键（形如 images/foo.png）
// 存在 STORAGE_LOCAL_DIR 下，公开访问仍走 /api/blob/<key>，与 S3 模式行为一致。

import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageBackend, StoredObject } from "./types";

function contentTypeByExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();

    const types: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".bmp": "image/bmp",
        ".pdf": "application/pdf",
        ".json": "application/json",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".zip": "application/zip",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
    };

    return types[ext] || "application/octet-stream";
}

/**
 * 把对象键映射到磁盘路径，并阻断 `..` 逃逸。
 * 上传的文件名来自用户输入，这里必须做规范化，否则可能写到目录之外。
 */
function resolvePath(rootDir: string, key: string): string {
    const normalizedKey = key.replace(/^[/\\]+/, "");

    if (normalizedKey.split(/[/\\]/).some((segment) => segment === "..")) {
        throw new Error(`Invalid storage key: ${key}`);
    }

    const fullPath = path.join(rootDir, normalizedKey);
    const resolvedRoot = path.resolve(rootDir);
    const resolvedTarget = path.resolve(fullPath);

    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Invalid storage key: ${key}`);
    }

    return resolvedTarget;
}

async function toUint8Array(body: Blob | ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
    if (typeof body === "string") {
        return new TextEncoder().encode(body);
    }
    if (body instanceof Uint8Array) {
        return body;
    }
    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }
    return new Uint8Array(await body.arrayBuffer());
}

export class LocalFileStorage implements StorageBackend {
    constructor(private readonly rootDir: string) {
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    private read(key: string): { data: Uint8Array; stat: fs.Stats } | null {
        const fullPath = resolvePath(this.rootDir, key);

        if (!fs.existsSync(fullPath)) {
            return null;
        }

        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
            return null;
        }

        return { data: new Uint8Array(fs.readFileSync(fullPath)), stat };
    }

    async get(key: string): Promise<StoredObject | null> {
        const result = this.read(key);
        if (!result) {
            return null;
        }

        return {
            body: result.data,
            size: result.data.byteLength,
            contentType: contentTypeByExtension(key),
            uploaded: result.stat.birthtime,
            lastModified: result.stat.mtime,
            etag: `W/"${result.stat.size}-${Math.floor(result.stat.mtimeMs)}"`,
        };
    }

    async head(key: string): Promise<StoredObject | null> {
        const result = this.read(key);
        if (!result) {
            return null;
        }

        return {
            body: null,
            size: result.stat.size,
            contentType: contentTypeByExtension(key),
            uploaded: result.stat.birthtime,
            lastModified: result.stat.mtime,
            etag: `W/"${result.stat.size}-${Math.floor(result.stat.mtimeMs)}"`,
        };
    }

    async put(
        key: string,
        body: Blob | ArrayBuffer | Uint8Array | string,
        contentType?: string,
    ): Promise<void> {
        const fullPath = resolvePath(this.rootDir, key);
        const bytes = await toUint8Array(body);

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, bytes);

        if (contentType) {
            // 记录一份 .meta 便于后续直接按元数据返回 Content-Type，
            // 不引入额外依赖，也避免每次读取都做扩展名推断。
            fs.writeFileSync(
                `${fullPath}.meta`,
                JSON.stringify({ contentType, uploaded: new Date().toISOString() }),
                "utf-8",
            );
        }
    }

    async delete(key: string): Promise<void> {
        const fullPath = resolvePath(this.rootDir, key);

        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        if (fs.existsSync(`${fullPath}.meta`)) {
            fs.unlinkSync(`${fullPath}.meta`);
        }
    }
}
