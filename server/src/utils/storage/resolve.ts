import { createR2ObjectStorage } from "./r2";
import { createS3ObjectStorage } from "./s3";
import { createSupabaseObjectStorage } from "./supabase";
import type { ObjectStorage, StorageProviderKind } from "./types";

/**
 * 解析应使用的对象存储后端。
 *
 * 优先级：
 *   1. 显式 `STORAGE_PROVIDER`（r2 / s3 / supabase）
 *   2. 配置自动探测：配了 Supabase → supabase，有 R2 binding → r2，否则 s3
 *
 * 自动探测保证既有部署行为不变：原先「不配R2_BUCKET_NAME 就走 S3」的
 * 语义在未设置 STORAGE_PROVIDER 时依然成立。
 */
export function resolveStorageProvider(env: Env): ObjectStorage {
    const explicit = normalizeProvider(env.STORAGE_PROVIDER);

    if (explicit === "supabase") {
        return createSupabaseObjectStorage(env);
    }

    if (explicit === "r2") {
        const r2 = createR2ObjectStorage(env);
        if (r2) {
            return r2;
        }
        // 显式指定 R2 却没绑binding，属于配置错误，提示更明确
        throw new Error("STORAGE_PROVIDER is r2 but R2_BUCKET binding is not configured");
    }

    if (explicit === "s3") {
        return createS3ObjectStorage(env);
    }

    // 未显式指定：按配置探测
    if (hasSupabaseConfig(env)) {
        return createSupabaseObjectStorage(env);
    }

    const r2 = createR2ObjectStorage(env);
    if (r2) {
        return r2;
    }

    return createS3ObjectStorage(env);
}

/** 只探测当前配置会命中哪个后端，不做必填校验。用于健康检查与日志。 */
export function detectStorageProviderKind(env: Env): StorageProviderKind {
    const explicit = normalizeProvider(env.STORAGE_PROVIDER);
    if (explicit) {
        return explicit;
    }

    if (hasSupabaseConfig(env)) {
        return "supabase";
    }

    return env.R2_BUCKET ? "r2" : "s3";
}

function normalizeProvider(value?: string): StorageProviderKind | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "r2" || normalized === "s3" || normalized === "supabase") {
        return normalized;
    }

    throw new Error(`STORAGE_PROVIDER "${value}" is not supported, expected r2, s3 or supabase`);
}

function hasSupabaseConfig(env: Env) {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_STORAGE_BUCKET);
}