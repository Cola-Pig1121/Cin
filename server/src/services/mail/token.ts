import { SignJWT } from 'jose';

/**
 * 主 Worker → 邮件网关 的调用凭证。
 *
 * ── 为什么不是直接共享 JWT_SECRET ──────────────────────
 * 两种朴素做法都有严重问题：
 *
 * 1. **网关共享主站 `JWT_SECRET`**
 *    - 用户登录 token 会被当成发信凭证：任何人都能拿自己的 JWT 调 `/api/send`，
 *      网关立刻变成 spam 跳板。
 *    - 网关一旦被攻破，攻击者持有 `JWT_SECRET` 即可伪造任意用户身份登录主站，
 *      两个系统的安全域被合并。
 *
 * 2. **静态共享 token（`MAIL_GATEWAY_TOKEN`）**
 *    无法区分调用方，也无法做到"仅主站可发信"。
 *
 * ── 本方案 ──────────────────────────────────────────────
 * 主站签发一个**用途受限、60 秒过期**的 JWT：
 * - `aud` 固定为 `rin-mail-gateway`：用户登录 token（无此 aud）验不过
 * - `purpose` 固定为 `mail-gateway`：双重保险，防止将来别的用途误用同一密钥
 * - `exp` = 签发后 60 秒：即使 token 泄露，攻击窗口也很小
 *
 * 网关侧只需要共享 `MAIL_JWT_SECRET`（建议独立密钥）。
 * 该密钥的权限边界被限制在"只能发邮件"，比共享 `JWT_SECRET` 安全得多。
 */

/** 网关的 audience 标识；网关侧会严格校验这个值 */
export const MAIL_GATEWAY_AUDIENCE = 'rin-mail-gateway';

/** purpose 声明，进一步限定 token 用途 */
export const MAIL_GATEWAY_PURPOSE = 'mail-gateway';

/** token 有效期（秒）。发信是一次性动作，不需要长有效期 */
export const MAIL_TOKEN_TTL_SECONDS = 60;

function toKey(secret: string | Uint8Array): Uint8Array {
  return typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
}

/**
 * 解析用于签发网关 token 的密钥。
 * 优先 `MAIL_JWT_SECRET`（推荐，独立密钥，权限边界最小）；
 * 未配置时回落到主站 `JWT_SECRET` 以兼容「零额外配置」的场景。
 */
export function resolveMailSigningSecret(env: Env): string | null {
  const dedicated = env.MAIL_JWT_SECRET?.trim();
  if (dedicated) {
    return dedicated;
  }

  const fallback = env.JWT_SECRET?.trim();
  return fallback || null;
}

/**
 * 签发一个调用邮件网关的短期 JWT。
 *
 * @param secret 签名密钥；留空则自动从 env 解析
 * @returns JWT 字符串；密钥缺失时返回 null（调用方应跳过签名，让网关拒绝请求）
 */
export async function signMailGatewayToken(
  secret: string | null | undefined,
  env?: Env,
): Promise<string | null> {
  const key = secret ?? (env ? resolveMailSigningSecret(env) : null);

  if (!key) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ purpose: MAIL_GATEWAY_PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + MAIL_TOKEN_TTL_SECONDS)
    .setAudience(MAIL_GATEWAY_AUDIENCE)
    .sign(toKey(key));
}
