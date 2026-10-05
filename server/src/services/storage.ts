import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { getStorageObject, putStorageObject } from "../utils/storage";

function buf2hex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

/** 只取安全的扩展名片段，防止 key 里带路径分隔符或空字节 */
function safeExtension(value: string | undefined): string {
    if (!value) {
        return '';
    }

    const ext = value.includes('.') ? (value.split('.').pop() ?? '') : '';
    return /^[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : '';
}

/** 依次从调用方 key、上传文件名中取扩展名 */
function resolveSuffix(key: string, fileName?: string): string {
    return safeExtension(key) || safeExtension(fileName);
}

export function StorageService(): Hono {
    const app = new Hono();

    // POST /storage
    app.post('/', async (c: AppContext) => {
        const uid = c.get('uid');
        const env = c.get('env');
        
        const body = await profileAsync(c, 'storage_parse', () => c.req.parseBody());
        // key 与 file 都是可选字段（前端只传 file），缺任一都应给出明确错误
        // 而不是让 undefined.includes 抛出 500
        const key = typeof body.key === 'string' ? body.key : '';
        const file = body.file as File | undefined;

        if (!uid) {
            return c.text('Unauthorized', 401);
        }

        if (!file || typeof file.arrayBuffer !== 'function') {
            return c.text('file is required', 400);
        }

        // 优先用调用方给的 key 后缀；key 为空时回退到上传文件名，
        // 否则会生成 "hash." 这种没有扩展名的对象键，浏览器无法正确识别类型
        const suffix = resolveSuffix(key, file.name);
        const fileBuffer = await profileAsync(c, 'storage_file_buffer', () => file.arrayBuffer());
        const hashArray = await profileAsync(c, 'storage_hash', () => crypto.subtle.digest(
            { name: 'SHA-1' },
            fileBuffer
        ));
        const hash = buf2hex(hashArray);
        const hashkey = suffix ? `${hash}.${suffix}` : hash;
        
        try {
            const result = await profileAsync(c, 'storage_put', () => putStorageObject(env, hashkey, file, file.type, new URL(c.req.url).origin));
            return c.json({ url: result.url });
        } catch (e: any) {
            console.error(e.message);
            const status = e.message?.includes('is not defined') ? 500 : 400;
            return c.text(e.message, status);
        }
    });

    return app;
}

export function BlobService(): Hono {
    const app = new Hono();

    app.get("/*", async (c: AppContext) => {
        const env = c.get("env");
        const key = c.req.path.replace(/^\/blob\/?/, "");

        if (!key) {
            return c.text("Blob key is required", 400);
        }

        try {
            const response = await profileAsync(c, "blob_fetch", () => getStorageObject(env, decodeURIComponent(key)));

            if (!response) {
                return c.text("Not found", 404);
            }

            return new Response(response.body, {
                status: response.status,
                headers: response.headers,
            });
        } catch (error) {
            console.error("Blob fetch failed:", error);
            return c.text("Blob fetch failed", 500);
        }
    });

    return app;
}
