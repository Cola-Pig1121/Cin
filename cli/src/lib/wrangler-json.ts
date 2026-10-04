/**
 * 解析 wrangler `--json` 的输出。
 *
 * wrangler 会在 JSON 之前插入非 JSON 的提示行，最常见的是设置了代理时的
 * "Proxy environment variables detected. We'll use your proxy for fetch requests."，
 * 它被写到 stdout。直接 JSON.parse 会抛
 * "JSON Parse error: Unexpected identifier "Proxy""，从而中断调用方流程。
 *
 * 这里从第一个 [ 或 { 开始截取，只取 JSON 文档部分。
 */
export function parseWranglerJson(stdout: string): any {
  const trimmed = stdout.trim();
  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");

  if (arrayStart === -1 && objectStart === -1) {
    throw new Error(`wrangler returned no JSON: ${trimmed.slice(0, 200)}`);
  }

  // 取更早出现的那个，保证截到完整的 JSON 文档
  const start =
    arrayStart === -1
      ? objectStart
      : objectStart === -1
        ? arrayStart
        : Math.min(arrayStart, objectStart);

  return JSON.parse(trimmed.slice(start));
}
