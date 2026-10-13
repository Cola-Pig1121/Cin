import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";

/**
 * uapis.cn 聚合接口代理（一言 / 随机图片 / 答案之书 / 二维码）。
 *
 * 全部走服务端代理：API Key 只从环境变量 UAPIS_API_KEY 读取、绝不下发到浏览器；
 * 目标 host 固定为 uapis.cn 且强制 https，参数一律经 URLSearchParams 编码，
 * 不接受调用方传入的任意 URL（防 SSRF）。
 */

const UAPIS_BASE = "https://uapis.cn/api/v1";
const ALLOWED_HOST = "uapis.cn";

function buildUpstream(path: string, params: Record<string, string | number | undefined>): URL {
  const url = new URL(`${UAPIS_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && `${value}`.length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  // 二次确认 host/协议（构造上已固定，这里防未来改动引入 SSRF）
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) {
    throw new Error("uapis upstream host/protocol rejected");
  }
  return url;
}

async function callUapis(
  c: AppContext,
  path: string,
  params: Record<string, string | number | undefined>,
  init: RequestInit = {},
): Promise<Response> {
  const url = buildUpstream(path, params);
  const env = c.get("env");
  const headers = new Headers(init.headers);
  if (env.UAPIS_API_KEY) {
    headers.set("Authorization", `Bearer ${env.UAPIS_API_KEY}`);
  }
  return fetch(url.toString(), { ...init, headers, cf: { cacheTtl: 0 } });
}

export function UapisService(): Hono {
  const app = new Hono();

  // GET /uapis/saying —— 一言
  app.get("/saying", async (c: AppContext) => {
    try {
      const res = await profileAsync(c, "uapis_saying", () => callUapis(c, "saying", {}));
      const data = await res.json().catch(() => null) as { text?: string } | null;
      if (!res.ok || !data?.text) {
        return c.json({ success: false, error: "saying unavailable" }, 502);
      }
      return c.json({ success: true, text: data.text });
    } catch {
      return c.json({ success: false, error: "saying unavailable" }, 502);
    }
  });

  // GET /uapis/answerbook?question= —— 答案之书
  app.get("/answerbook", async (c: AppContext) => {
    const question = (c.req.query("question") ?? "").trim();
    if (!question) {
      return c.json({ success: false, error: "question is required" }, 400);
    }
    if (question.length > 200) {
      return c.json({ success: false, error: "question too long" }, 400);
    }
    try {
      const res = await profileAsync(c, "uapis_answerbook", () => callUapis(c, "answerbook/ask", { question }));
      const data = await res.json().catch(() => null) as { answer?: string; question?: string } | null;
      if (!res.ok || !data?.answer) {
        return c.json({ success: false, error: "answer unavailable" }, 502);
      }
      return c.json({ success: true, question: data.question ?? question, answer: data.answer });
    } catch {
      return c.json({ success: false, error: "answer unavailable" }, 502);
    }
  });

  // GET /uapis/random-image?category=&type= —— 透传上游图片流（同源，避免浏览器直连第三方）
  app.get("/random-image", async (c: AppContext) => {
    const category = (c.req.query("category") ?? "").trim();
    const type = (c.req.query("type") ?? "").trim();
    try {
      const res = await profileAsync(c, "uapis_random_image", () =>
        callUapis(c, "random/image", { category: category || undefined, type: type || undefined }),
      );
      if (!res.ok || !res.body) {
        return c.text("image unavailable", 502);
      }
      return new Response(res.body, {
        status: 200,
        headers: {
          "content-type": res.headers.get("content-type") ?? "image/jpeg",
          "cache-control": "no-store",
        },
      });
    } catch {
      return c.text("image unavailable", 502);
    }
  });

  // GET /uapis/qrcode?text=&size=&format= —— 二维码（默认透传 png；format=json 返回 url）
  app.get("/qrcode", async (c: AppContext) => {
    const text = (c.req.query("text") ?? "").trim();
    if (!text) {
      return c.json({ success: false, error: "text is required" }, 400);
    }
    if (text.length > 1000) {
      return c.json({ success: false, error: "text too long" }, 400);
    }
    const size = Number.parseInt(c.req.query("size") ?? "", 10);
    const format = c.req.query("format") === "json" ? "json" : undefined;
    try {
      const res = await profileAsync(c, "uapis_qrcode", () =>
        callUapis(c, "image/qrcode", {
          text,
          size: Number.isFinite(size) ? Math.min(Math.max(size, 256), 2048) : undefined,
          format,
        }),
      );
      if (!res.ok) {
        return c.text("qrcode unavailable", 502);
      }
      if (format === "json") {
        return c.json(await res.json());
      }
      return new Response(res.body, {
        status: 200,
        headers: {
          "content-type": res.headers.get("content-type") ?? "image/png",
          "cache-control": "public, max-age=3600",
        },
      });
    } catch {
      return c.text("qrcode unavailable", 502);
    }
  });

  return app;
}
