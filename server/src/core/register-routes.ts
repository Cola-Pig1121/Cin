import type { RinApp } from "./app-types";
import { AdminUserService } from "../services/admin-users";
import { PasswordAuthService } from "../services/auth";
import { CommentService } from "../services/comments";
import { ConfigService } from "../services/config";
import { FaviconService } from "../services/favicon";
import { FeedService, SearchService, WordPressService } from "../services/feed";
import { FriendService } from "../services/friends";
import { MomentsService } from "../services/moments";
import { RegistrationService } from "../services/registration";
import { RSSService } from "../services/rss";
import { SitemapService } from "../services/sitemap";
import { BlobService, StorageService } from "../services/storage";
import { TagService } from "../services/tag";
import { UserService } from "../services/user";

export function registerRoutes(app: RinApp) {
  app.get("/", (c) => c.text("Hi"));

  app.route("/feed", FeedService());
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
  app.route("/auth", PasswordAuthService());
  // 注册与登录共用 /auth 前缀：/auth/register/request、/auth/register/verify
  app.route("/auth", RegistrationService());
  app.route("/config", ConfigService());
  app.route("/", RSSService());
  app.route("/", SitemapService());
  app.route("/favicon", FaviconService());
  app.route("/favicon.ico", FaviconService());
}
