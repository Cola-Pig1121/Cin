import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { createMockEnv } from "../../../tests/fixtures";
import { UapisService } from "../uapis";

function buildApp(): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  app.use(async (c, next) => {
    c.set("env", createMockEnv({ UAPIS_API_KEY: "test-uapis-key" }));
    await next();
  });
  // UapisService 用 AppContext 类型；测试里以普通 Hono 挂载
  app.route("/uapis", UapisService() as never);
  return app;
}

describe("UapisService", () => {
  let urls: string[] = [];
  let authHeader: string | null = null;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    urls = [];
    authHeader = null;
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      authHeader = new Headers(init?.headers).get("authorization");
      const body = url.includes("/saying")
        ? JSON.stringify({ text: "一句话" })
        : url.includes("/answerbook")
          ? JSON.stringify({ question: "q", answer: "是的" })
          : url.includes("/qrcode")
            ? JSON.stringify({ url: "data:image/png;base64,AAA" })
            : "binary-image";
      return new Response(body, {
        status: 200,
        headers: { "content-type": url.includes("random/image") ? "image/jpeg" : "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("proxies saying to uapis.cn with the server-side key header", async () => {
    const res = await buildApp().request("/uapis/saying");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, text: "一句话" });
    expect(urls[0]).toBe("https://uapis.cn/api/v1/saying");
    expect(authHeader).toBe("Bearer test-uapis-key");
  });

  it("validates and encodes the answerbook question", async () => {
    const app = buildApp();
    const bad = await app.request("/uapis/answerbook");
    expect(bad.status).toBe(400);
    expect(urls.length).toBe(0); // 未带 question 不该打上游

    const ok = await app.request("/uapis/answerbook?question=" + encodeURIComponent("今天好吗?"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, answer: "是的" });
    expect(urls[0]).toContain("https://uapis.cn/api/v1/answerbook/ask?question=");
  });

  it("always targets uapis.cn host (no caller-controlled URL)", async () => {
    await buildApp().request("/uapis/qrcode?text=" + encodeURIComponent("https://evil.example/x"));
    const url = new URL(urls[0]);
    expect(url.hostname).toBe("uapis.cn");
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("text")).toBe("https://evil.example/x"); // 作为参数值，不是目标
  });

  it("streams random-image through same origin", async () => {
    const res = await buildApp().request("/uapis/random-image?category=acg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(urls[0]).toContain("https://uapis.cn/api/v1/random/image");
    expect(new URL(urls[0]).searchParams.get("category")).toBe("acg");
  });
});
