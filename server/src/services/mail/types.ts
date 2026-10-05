/**
 * 邮件发送 Provider 抽象。
 *
 * 为什么需要这一层：SMTP 直连在 Workers 上受 `cloudflare:sockets` 约束
 * （端口受限、需要 STARTTLS 或隐式 TLS），而很多团队已经有成熟的邮件服务
 * 或自建 HTTP 网关。硬绑一种传输方式会让部署方被迫二选一。
 *
 * 三种 Provider：
 * - `smtp`：直连 SMTP，配置最少，适合自建邮件中继
 * - `resend`：Resend HTTP API（也兼容任何 Resend 风格的 HTTP 邮件网关）
 * - `custom`：自定义 HTTP 网关，完全自定义请求体与鉴权头
 *
 * 所有 Provider 都实现同一个 `MailProvider` 接口，
 * 上层（注册流程）只依赖 `sendMail()`，不关心底层走哪条路。
 */

export type MailProviderKind = 'smtp' | 'resend' | 'custom';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface MailProvider {
  kind: MailProviderKind;
  /** 展示用描述，仅用于日志与健康检查，不含任何凭证 */
  describe(): string;
  send(message: MailMessage): Promise<void>;
}

/** 邮件发送失败。`code` 保留底层错误信息便于排查。 */
export class MailDeliveryError extends Error {
  readonly provider: MailProviderKind;
  readonly status?: number;

  constructor(provider: MailProviderKind, message: string, status?: number) {
    super(message);
    this.name = 'MailDeliveryError';
    this.provider = provider;
    this.status = status;
  }
}

/**
 * 自定义 HTTP 网关的请求/响应约定。
 *
 * 约定一套最小契约，这样任何自建网关只要实现它就能对接：
 *   请求：POST {endpoint}
 *   鉴权：header（默认 Authorization: Bearer {token}）
 *   请求体：{ from, to, subject, text, html }
 *   响应：2xx 视为成功；可选返回 { ok: boolean, error?: string }
 */
export type CustomGatewayConfig = {
  /** 网关地址，如 https://smtp.example.com/api/send */
  endpoint: string;
  /** 鉴权 token；留空表示网关不需要鉴权（不推荐） */
  token?: string;
  /** 鉴权头名称，默认 Authorization */
  authHeader?: string;
  /**
   * 鉴权头的值模板。默认 `Bearer {token}`。
   * 有些网关用 `X-Mail-Token: {token}` 或 `Token {token}`，这里可自定义。
   */
  authValueTemplate?: string;
  /** 请求体字段名映射，默认与标准字段同名 */
  fieldNames?: {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  };
  /** 发件人地址；网关若不支持可留空 */
  from?: string;
  /** 附加请求头 */
  headers?: Record<string, string>;
  /** 请求超时（毫秒），默认 15000 */
  timeoutMs?: number;
};
