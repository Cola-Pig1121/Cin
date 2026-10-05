// ============================================================================
// Shared API Error Codes - Used by both client and server
// ============================================================================
//
// 为什么需要这一层：前端不应再靠匹配后端返回的英文字符串（如 "Content is required"）
// 来决定提示文案。后端文案一改，前端就会静默失效。
//
// 约定：
// - 后端抛出错误时，message 保持人类可读（英文），但 `error.code` 必须是本文件中的常量。
// - 前端只依赖 code 做分支与 i18n 映射，message 仅作为兜底展示。
// - 新增错误码时必须同时补齐 4 份 locale 的翻译。

export const COMMENT_ERROR_CODES = {
  /** 请求体未通过 schema 校验 */
  COMMENT_VALIDATION_FAILED: 'COMMENT_VALIDATION_FAILED',
  /** 评论内容为空 */
  COMMENT_CONTENT_REQUIRED: 'COMMENT_CONTENT_REQUIRED',
  /** 评论内容超长 */
  COMMENT_CONTENT_TOO_LONG: 'COMMENT_CONTENT_TOO_LONG',
  /** 目标文章不存在 */
  COMMENT_FEED_NOT_FOUND: 'COMMENT_FEED_NOT_FOUND',
  /** 游客评论必须填写昵称 */
  COMMENT_GUEST_NAME_REQUIRED: 'COMMENT_GUEST_NAME_REQUIRED',
  /** 游客评论未开启 */
  COMMENT_GUEST_DISABLED: 'COMMENT_GUEST_DISABLED',
  /** 评论功能未开启 */
  COMMENT_DISABLED: 'COMMENT_DISABLED',
  /** Turnstile 人机验证未通过 */
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  /** 需要 Turnstile token 但未提供 */
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  /** 未登录且不允许游客评论 */
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  /** 无权删除该评论 */
  COMMENT_PERMISSION_DENIED: 'COMMENT_PERMISSION_DENIED',
  /** 评论不存在 */
  COMMENT_NOT_FOUND: 'COMMENT_NOT_FOUND',
  /** 提交过于频繁 */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type CommentErrorCode =
  (typeof COMMENT_ERROR_CODES)[keyof typeof COMMENT_ERROR_CODES];

export const AUTH_ERROR_CODES = {
  /** 用户名或密码错误 */
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** 缺少用户名或密码 */
  AUTH_CREDENTIALS_REQUIRED: 'AUTH_CREDENTIALS_REQUIRED',
  /** 未登录 */
  AUTH_LOGIN_REQUIRED: 'AUTH_LOGIN_REQUIRED',
  /** 邮箱已注册 */
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  /** 用户名已被占用 */
  AUTH_USERNAME_TAKEN: 'AUTH_USERNAME_TAKEN',
  /** 邮箱格式非法 */
  AUTH_EMAIL_INVALID: 'AUTH_EMAIL_INVALID',
  /** 验证码错误或已过期 */
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
  /** 验证码发送过于频繁 */
  AUTH_CODE_TOO_FREQUENT: 'AUTH_CODE_TOO_FREQUENT',
  /** 密码强度不足 */
  AUTH_PASSWORD_WEAK: 'AUTH_PASSWORD_WEAK',
  /** 注册功能未开启 */
  AUTH_REGISTER_DISABLED: 'AUTH_REGISTER_DISABLED',
  /** 邮件服务未配置 */
  AUTH_SMTP_NOT_CONFIGURED: 'AUTH_SMTP_NOT_CONFIGURED',
  /** 邮件发送失败 */
  AUTH_EMAIL_SEND_FAILED: 'AUTH_EMAIL_SEND_FAILED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const TURNS = {
  CAPTCHA: 'CAPTCHA',
  COMMENT: 'COMMENT',
  AUTH: 'AUTH',
} as const;

/**
 * 全部业务错误码，供服务端 `AppError` 之外的场景做穷尽性检查。
 */
export const API_ERROR_CODES = {
  ...COMMENT_ERROR_CODES,
  ...AUTH_ERROR_CODES,
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * i18n key 约定：`apiError.<code>`，前端用同一套映射表查 4 份语言文件。
 * code 本身不携带语义前缀，便于翻译者按业务语境理解。
 */
export function commentErrorI18nKey(code: string): string | undefined {
  return code in COMMENT_ERROR_CODES ? `apiError.${code}` : undefined;
}

export function authErrorI18nKey(code: string): string | undefined {
  return code in AUTH_ERROR_CODES ? `apiError.${code}` : undefined;
}
