/**
 * IndexNow 主动推送：文章创建/更新后把 URL 推给 Bing/Yandex/Seznam 等，
 * 秒级进抓取队列，不必等爬虫。
 *
 * - key 只从环境变量 INDEXNOW_KEY 读取（源码/示例/测试不含明文）。
 * - 端点固定 https://api.bing.com/indexnow，发请求前校验 host/协议（防 SSRF）。
 * - 失败只记日志，绝不影响发文主流程。
 */

const INDEXNOW_ENDPOINT = "https://api.bing.com/indexnow";
const ALLOWED_HOST = "api.bing.com";

export async function notifyIndexNow(env: Env, urls: string[]): Promise<void> {
    const key = env.INDEXNOW_KEY;
    if (!key || urls.length === 0) return;

    try {
        const endpoint = new URL(INDEXNOW_ENDPOINT);
        if (endpoint.protocol !== "https:" || endpoint.hostname !== ALLOWED_HOST) {
            return;
        }
        const host = new URL(urls[0]).host;
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ host, key, urlList: urls.slice(0, 10_000) }),
        });
        if (!res.ok) {
            console.error(`[indexnow] push failed: HTTP ${res.status}`);
        }
    } catch (error) {
        console.error("[indexnow] push error", error);
    }
}
