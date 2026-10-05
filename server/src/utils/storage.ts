import { path_join } from "./path";
import { buildS3ObjectUrl, createS3Client, putObject as putS3Object } from "./s3";
import { getRuntimeContext } from "../runtime/context";
import { resolveRuntimeKind, isLocalRuntime } from "../runtime/types";
import type { StorageBackend, StoredObject } from "../runtime/types";

type StorageTarget =
    | {
          type: "r2";
          bucket: R2Bucket;
          folder: string;
          publicBaseUrl: string;
      }
    | {
          type: "s3";
          env: Env;
          folder: string;
          publicBaseUrl: string;
      };

function trimTrailingSlash(value: string) {
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * 本地磁盘模式下 R2_BUCKET / S3_ENDPOINT 都不存在，
 * 用 RIN_UPLOAD_DIR 指向的目录替代（见 runtime/local-storage.ts）。
 */
async function getLocalBackend(env: Env): Promise<StorageBackend> {
    // getRuntimeContext 在本地运行时复用进程内单例，这里的 env 决定
    // 上传目录等路径配置，因此必须把调用方的 env 原样传下去
    const context = await getRuntimeContext({
        kind: "local",
        env,
    });

    if (!context.storage) {
        throw new Error("Local storage backend is not available");
    }

    return context.storage;
}

export function resolveStorageTarget(env: Env): StorageTarget {
    const folder = env.S3_FOLDER || "";
    const publicBaseUrl = trimTrailingSlash(env.S3_ACCESS_HOST || env.S3_ENDPOINT || "");

    if (env.R2_BUCKET) {
        return {
            type: "r2",
            bucket: env.R2_BUCKET,
            folder,
            publicBaseUrl,
        };
    }

    if (!env.S3_ENDPOINT) {
        throw new Error("S3_ENDPOINT is not defined");
    }
    if (!env.S3_ACCESS_KEY_ID) {
        throw new Error("S3_ACCESS_KEY_ID is not defined");
    }
    if (!env.S3_SECRET_ACCESS_KEY) {
        throw new Error("S3_SECRET_ACCESS_KEY is not defined");
    }
    if (!env.S3_BUCKET) {
        throw new Error("S3_BUCKET is not defined");
    }

    return {
        type: "s3",
        env,
        folder,
        publicBaseUrl,
    };
}

function encodeStorageKey(key: string) {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildBlobUrl(storageKey: string, baseUrl?: string) {
  const encodedKey = encodeStorageKey(storageKey);
  const path = `/api/blob/${encodedKey}`;

  if (!baseUrl) {
    return path;
  }

  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function createStorageResponse(object: R2ObjectBody | R2Object, body?: BodyInit | null) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }

  if (!headers.has("Content-Length")) {
    headers.set("Content-Length", String(object.size));
  }

  if (!headers.has("Last-Modified")) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  if (!headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  return new Response(body ?? null, {
    status: 200,
    headers,
  });
}

/** 本地磁盘返回的 StoredObject → HTTP Response */
function createLocalStorageResponse(object: StoredObject): Response {
    const headers = new Headers();

    if (object.contentType) {
        headers.set("Content-Type", object.contentType);
    }
    if (object.etag) {
        headers.set("ETag", object.etag);
    }

    headers.set("Content-Length", String(object.size));

    const lastModified = object.lastModified ?? object.uploaded;
    if (lastModified) {
        headers.set("Last-Modified", lastModified.toUTCString());
    }
    if (!headers.has("Cache-Control")) {
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    if (!headers.has("Access-Control-Allow-Origin")) {
        headers.set("Access-Control-Allow-Origin", "*");
    }

    return new Response(object.body as BodyInit | null, {
        status: 200,
        headers,
    });
}

/** 走本地磁盘还是 R2/S3，由运行时与配置共同决定 */
function isLocalStorageMode(env: Env) {
    if (!isLocalRuntime(resolveRuntimeKind(env as unknown as { RIN_RUNTIME?: string }))) {
        return false;
    }

    const explicit = (env.RIN_STORAGE_BACKEND || "").trim().toLowerCase();
    if (explicit === "local") {
        return true;
    }
    if (explicit === "s3") {
        return false;
    }

    // 本地运行时下没有 R2 绑定，没有 S3_ENDPOINT 就退回磁盘
    return !env.R2_BUCKET && !env.S3_ENDPOINT;
}

export async function getStorageObject(env: Env, storageKey: string): Promise<Response | null> {
    if (isLocalStorageMode(env)) {
        const object = await (await getLocalBackend(env)).get(storageKey);
        return object ? createLocalStorageResponse(object) : null;
    }

    if (env.R2_BUCKET) {
    const object = await env.R2_BUCKET.get(storageKey);
    if (!object) {
      return null;
    }
    return createStorageResponse(object, object.body);
  }

  const client = createS3Client(env);
  const response = await client.fetch(buildS3ObjectUrl(env, storageKey), {
    method: "GET",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch storage object: ${response.status} ${response.statusText}`);
  }

  return response;
}

export async function headStorageObject(env: Env, storageKey: string): Promise<Response | null> {
    if (isLocalStorageMode(env)) {
        const object = await (await getLocalBackend(env)).head(storageKey);
        return object ? createLocalStorageResponse(object) : null;
    }

    if (env.R2_BUCKET) {
    const object = await env.R2_BUCKET.head(storageKey);
    if (!object) {
      return null;
    }
    return createStorageResponse(object);
  }

  const client = createS3Client(env);
  const response = await client.fetch(buildS3ObjectUrl(env, storageKey), {
    method: "HEAD",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to inspect storage object: ${response.status} ${response.statusText}`);
  }

  return response;
}

export function getStoragePublicUrl(env: Env, storageKey: string, baseUrl?: string) {
  if (env.S3_ACCESS_HOST) {
    return `${trimTrailingSlash(env.S3_ACCESS_HOST)}/${storageKey}`;
  }

  return buildBlobUrl(storageKey, baseUrl);
}

export async function putStorageObject(
  env: Env,
  key: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  contentType?: string,
  baseUrl?: string,
) {
  // 本地磁盘模式没有 R2/S3 绑定，resolveStorageTarget 会直接抛
  // "S3_ENDPOINT is not defined"，所以必须在这里提前分流
  if (isLocalStorageMode(env)) {
    const storageKey = path_join(env.S3_FOLDER || "", key);

    await (await getLocalBackend(env)).put(storageKey, body, contentType);

    return {
      key: storageKey,
      url: getStoragePublicUrl(env, storageKey, baseUrl),
    };
  }

  const target = resolveStorageTarget(env);
  const storageKey = path_join(target.folder, key);

  return putStorageObjectAtKey(env, storageKey, body, contentType, baseUrl);
}

export async function putStorageObjectAtKey(
  env: Env,
  storageKey: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  contentType?: string,
  baseUrl?: string,
) {
  if (isLocalStorageMode(env)) {
    // storageKey 已经是含前缀的完整对象键，这里不再拼接 folder
    // （前缀由调用方 putStorageObject 通过 resolveStorageTarget 处理好）
    await (await getLocalBackend(env)).put(storageKey, body, contentType);

    return {
      key: storageKey,
      url: getStoragePublicUrl(env, storageKey, baseUrl),
    };
  }

  if (env.R2_BUCKET) {
    await env.R2_BUCKET.put(storageKey, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
  } else {
    const client = createS3Client(env);
    await putS3Object(client, env, storageKey, body, contentType);
  }

  return {
    key: storageKey,
    url: getStoragePublicUrl(env, storageKey, baseUrl),
  };
}
