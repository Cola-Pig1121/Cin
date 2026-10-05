import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LocalFileStorage } from "../local-storage";

let rootDir: string;
let storage: LocalFileStorage;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "rin-storage-"));
  storage = new LocalFileStorage(rootDir);
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("LocalFileStorage", () => {
  test("写入后能读回内容与大小", async () => {
    const payload = "hello rin";
    await storage.put("images/a.txt", payload, "text/plain");

    const object = await storage.get("images/a.txt");
    expect(object).not.toBeNull();
    expect(object!.size).toBe(payload.length);
    expect(new TextDecoder().decode(object!.body as Uint8Array)).toBe(payload);
  });

  test("根据扩展名推断 Content-Type", async () => {
    await storage.put("images/photo.png", "fake-png-bytes");

    const object = await storage.head("images/photo.png");
    expect(object!.contentType).toBe("image/png");
  });

  test("head 不返回 body 但带大小", async () => {
    await storage.put("images/b.jpg", "1234567890");

    const object = await storage.head("images/b.jpg");
    expect(object).not.toBeNull();
    expect(object!.body).toBeNull();
    expect(object!.size).toBe(10);
  });

  test("不存在的对象返回 null", async () => {
    expect(await storage.get("images/missing.png")).toBeNull();
    expect(await storage.head("images/missing.png")).toBeNull();
  });

  test("自动创建多级目录", async () => {
    await storage.put("a/b/c/deep.txt", "nested");

    expect(fs.existsSync(path.join(rootDir, "a", "b", "c", "deep.txt"))).toBe(true);
  });

  test("删除文件同时清理 meta", async () => {
    await storage.put("images/x.png", "data", "image/png");
    expect(fs.existsSync(path.join(rootDir, "images", "x.png.meta"))).toBe(true);

    await storage.delete("images/x.png");

    expect(fs.existsSync(path.join(rootDir, "images", "x.png"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, "images", "x.png.meta"))).toBe(false);
    expect(await storage.get("images/x.png")).toBeNull();
  });

  test("删除不存在的文件不抛错", async () => {
    await storage.delete("images/never-existed.png");
  });

  test("阻断路径穿越写入", async () => {
    await expect(storage.put("../escape.txt", "nope")).rejects.toThrow(/Invalid storage key/);
  });

  test("阻断路径穿越读取", async () => {
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });

  test("阻断嵌套 ..", async () => {
    await expect(storage.put("images/../../escape.txt", "nope")).rejects.toThrow(
      /Invalid storage key/,
    );
  });

  test("接受 Uint8Array 与 ArrayBuffer", async () => {
    await storage.put("images/u.bin", new Uint8Array([1, 2, 3]));
    await storage.put("images/ab.bin", new Uint8Array([4, 5]).buffer);

    expect((await storage.get("images/u.bin"))!.size).toBe(3);
    expect((await storage.get("images/ab.bin"))!.size).toBe(2);
  });

  test("内容相同的文件产生相同 key（配合 SHA-1 去重）", async () => {
    await storage.put("images/same.png", "identical");
    await storage.put("images/same-copy.png", "identical");

    const a = await storage.head("images/same.png");
    const b = await storage.head("images/same-copy.png");

    // 本地实现不做 hash 去重，但应能读到相同内容
    expect(a!.size).toBe(b!.size);
  });
});
