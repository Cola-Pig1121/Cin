import type { RinApp } from "./app-types";
import { AdminUserService } from "../services/admin-users";
import { AdminFeedsService } from "../services/admin-feeds";
import { PasswordAuthService } from "../services/auth";
import { CommentService } from "../services/comments";
import { ConfigService } from "../services/config";
import { FaviconService } from "../services/favicon";
import { FeedService, SearchService, WordPressService } from "../services/feed";
import { FeedWriteApiService } from "../services/feed-write-api";
import { FriendService } from "../services/friends";
import { MomentsService } from "../services/moments";
import { RegistrationService } from "../services/registration";
import { RSSService } from "../services/rss";
import { SitemapService } from "../services/sitemap";
import { BlobService, StorageService } from "../services/storage";
import { TagService } from "../services/tag";
import { UapisService } from "../services/uapis";
import { UserService } from "../services/user";

export function registerRoutes(app: RinApp) {
  app.get("/", (c) => c.text("Hi"));

  app.route("/feed", FeedService());
  // 文章写入 API：与网页端创建文章分开，供脚本/CI 调用（结构化 JSON + dryRun）
  app.route("/feed-write", FeedWriteApiService());
  app.route("/search", SearchService());
  app.route("/wp", WordPressService());
  app.route("/tag", TagService());
  app.route("/comment", CommentService());
  app.route("/storage", StorageService());
  app.route("/blob", BlobService());
  app.route("/friend", FriendService());
  app.route("/moments", MomentsService());
  app.route("/user", UserService());
  // 管理员后台：用户列表 / 改权限 / 删除。每个端点内部独立校验 admin 标记。
  app.route("/admin", AdminUserService());
  // 管理员后台：全站文章统一管理（含草稿/未列出）与批量删除，端点内部独立校验 admin
  app.route("/admin", AdminFeedsService());
  app.route("/auth", PasswordAuthService());
  // 注册与登录共用 /auth 前缀：/auth/register/request、/auth/register/verify
  app.route("/auth", RegistrationService());
  app.route("/config", ConfigService());
  app.route("/", RSSService());
  app.route("/", SitemapService());
  app.route("/favicon", FaviconService());
  app.route("/favicon.ico", FaviconService());
  // uapis.cn 聚合接口代理（一言 / 随机图片 / 答案之书 / 二维码），API Key 只留在服务端
  app.route("/uapis", UapisService());
}
