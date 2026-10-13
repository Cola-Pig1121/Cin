import type { ReactNode } from "react";
import { lazy, Suspense, useContext } from "react";
import type { DefaultParams, PathPattern } from "wouter";
import { Route, Switch, useLocation } from "wouter";
import { AdminLayout } from "../components/admin-layout";
import Footer from "../components/footer";
import { Header } from "../components/header";
import { Padding } from "../components/padding";
import { getHeaderLayoutDefinition } from "../components/site-header/layout-registry";
import { Tips, TipsPage } from "../components/tips";
import useTableOfContents from "../hooks/useTableOfContents";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ErrorPage } from "../page/error";
import { TOCHeader } from "../page/feed-toc-header";
import { ProfileContext } from "../state/profile";
import { tryInt } from "../utils/int";
import { useTranslation } from "react-i18next";

// 路由级代码分割：每个页面（及其重依赖，如 writing 的 monaco/mermaid、feed 的
// markdown 代码高亮）拆成独立 chunk，由 Cloudflare 边缘按需缓存分发，
// 首屏主包只保留外壳。named export 需映射到 default。
const lazyNamed = (factory: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => factory().then((m) => ({ default: m[name] as React.ComponentType<any> })));

const CallbackPage = lazyNamed(() => import("../page/callback"), "CallbackPage");
const CompatTasksPage = lazyNamed(() => import("../page/compat-tasks"), "CompatTasksPage");
const AdminArticlesPage = lazyNamed(() => import("../page/admin-articles"), "AdminArticlesPage");
const AdminUsersPage = lazyNamed(() => import("../page/admin-users"), "AdminUsersPage");
const CommentModerationPage = lazyNamed(() => import("../page/comment-moderation"), "CommentModerationPage");
const FeedPage = lazyNamed(() => import("../page/feed"), "FeedPage");
const FeedsPage = lazyNamed(() => import("../page/feeds"), "FeedsPage");
const FriendsPage = lazyNamed(() => import("../page/friends"), "FriendsPage");
const AnswerBookPage = lazyNamed(() => import("../page/answerbook"), "AnswerBookPage");
const HealthPage = lazyNamed(() => import("../page/health"), "HealthPage");
const HashtagPage = lazyNamed(() => import("../page/hashtag"), "HashtagPage");
const HashtagsPage = lazyNamed(() => import("../page/hashtags"), "HashtagsPage");
const LoginPage = lazyNamed(() => import("../page/login"), "LoginPage");
const MomentsPage = lazyNamed(() => import("../page/moments"), "MomentsPage");
const ProfilePage = lazyNamed(() => import("../page/profile"), "ProfilePage");
const QueueStatusPage = lazyNamed(() => import("../page/queue-status"), "QueueStatusPage");
const RegisterPage = lazyNamed(() => import("../page/register"), "RegisterPage");
const SearchPage = lazyNamed(() => import("../page/search"), "SearchPage");
const Settings = lazyNamed(() => import("../page/settings"), "Settings");
const TimelinePage = lazyNamed(() => import("../page/timeline"), "TimelinePage");
const WritingPage = lazyNamed(() => import("../page/writing"), "WritingPage");

// 懒加载首帧占位：预留高度，避免内容出现时把页脚顶动造成 CLS
function RouteFallback() {
  return <div className="min-h-[60vh] w-full" aria-busy="true" />;
}

export function AppRoutes() {
  const { t } = useTranslation();

  return (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      <AppRoute path="/">
        <FeedsPage />
      </AppRoute>

      <AppRoute path="/timeline">
        <TimelinePage />
      </AppRoute>

      <AppRoute path="/moments">
        <MomentsPage />
      </AppRoute>

      <AppRoute path="/friends">
        <FriendsPage />
      </AppRoute>

      <AppRoute path="/answerbook">
        <AnswerBookPage />
      </AppRoute>

      <AppRoute path="/hashtags">
        <HashtagsPage />
      </AppRoute>

      <AppRoute path="/hashtag/:name">
        {(params) => <HashtagPage name={params.name || ""} />}
      </AppRoute>

      <AppRoute path="/search/:keyword">
        {(params) => <SearchPage keyword={params.keyword || ""} />}
      </AppRoute>

      <AdminRoute path="/admin/settings" requirePermission title={t("settings.title")} description={t("admin.settings_description")}>
        <Settings />
      </AdminRoute>

      <AdminRoute path="/admin/health" requirePermission title={t("health.title")} description={t("admin.health_description")}>
        <HealthPage />
      </AdminRoute>

      <AdminRoute path="/admin/comments" requirePermission title={t("moderation.title")} description={t("admin.comments_description")}>
        <CommentModerationPage />
      </AdminRoute>

      <AdminRoute path="/admin/users" requirePermission title={t("admin_users.title")} description={t("admin.users_description")}>
        <AdminUsersPage />
      </AdminRoute>

      <AdminRoute path="/admin/articles" requirePermission title={t("admin_articles.title")} description={t("admin_articles.description")}>
        <AdminArticlesPage />
      </AdminRoute>

      <AdminRoute path="/admin/queue-status" requirePermission title={t("queue_status.title")} description={t("admin.queue_status_description")}>
        <QueueStatusPage />
      </AdminRoute>

      <AdminRoute path="/admin/compat-tasks" requirePermission title={t("compat_tasks.title")} description={t("admin.compat_tasks_description")}>
        <CompatTasksPage />
      </AdminRoute>

      <AdminRoute path="/admin/writing" requirePermission title={t("writing")} description={t("admin.writing_description")}>
        <WritingPage />
      </AdminRoute>

      <AdminRoute path="/admin/writing/:id" requirePermission title={t("writing")} description={t("admin.writing_description")}>
        {({ id }) => <WritingPage id={tryInt(0, id)} />}
      </AdminRoute>

      <AppRoute path="/callback">
        <CallbackPage />
      </AppRoute>

      <AppRoute path="/login">
        <LoginPage />
      </AppRoute>

      <AppRoute path="/register">
        <RegisterPage />
      </AppRoute>

      <AppRoute path="/profile">
        <ProfilePage />
      </AppRoute>

      <TocRoute path="/feed/:id">
        {(params, toc, cleanup) => <FeedPage id={params.id || ""} TOC={toc} clean={cleanup} />}
      </TocRoute>

      <TocRoute path="/:alias">
        {(params, toc, cleanup) => <FeedPage id={params.alias || ""} TOC={toc} clean={cleanup} />}
      </TocRoute>

      <AppRoute path="/user/github">
        <TipsPage>
          <Tips value={t("error.api_url")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute path="/*/user/github">
        <TipsPage>
          <Tips value={t("error.api_url_slash")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute path="/user/github/callback">
        <TipsPage>
          <Tips value={t("error.github_callback")} type="error" />
        </TipsPage>
      </AppRoute>

      <AppRoute>
        <ErrorPage error={t("error.not_found")} />
      </AppRoute>
    </Switch>
    </Suspense>
  );
}

function AppRoute({
  path,
  children,
  headerComponent,
  paddingClassName,
  requirePermission,
}: {
  path?: PathPattern;
  children: ReactNode | ((params: DefaultParams) => ReactNode);
  headerComponent?: ReactNode;
  paddingClassName?: string;
  requirePermission?: boolean;
}) {
  const profile = useContext(ProfileContext);
  const siteConfig = useSiteConfig();
  const { t } = useTranslation();

  // profile 三态：undefined=加载中、null=未登录、对象=已登录。
  // 加载中不能判为「无权限」，否则管理员进后台会先闪一下「权限不足」。
  const isProfileLoading = profile === undefined;
  const content = requirePermission && !isProfileLoading && !profile?.permission ? (
    <ErrorPage error={t("error.permission_denied")} />
  ) : (
    children
  );

  return (
    <Route path={path}>
      {(params) => {
        const resolvedContent = typeof content === "function" ? content(params) : content;
        const layoutDefinition = getHeaderLayoutDefinition(siteConfig.headerLayout);
        // 插件插槽要按当前路径过滤，传真实路径而非 Route 的 path prop（可能是通配符）
        const [location] = useLocation();

        return layoutDefinition.renderRouteShell({
          header: <Header>{headerComponent}</Header>,
          content: <Padding className={paddingClassName}>{resolvedContent}</Padding>,
          footer: <Footer />,
          paddingClassName,
          path: location,
        });
      }}
    </Route>
  );
}

function AdminRoute({
  path,
  children,
  requirePermission,
  title,
  description,
}: {
  path: PathPattern;
  children: ReactNode | ((params: DefaultParams) => ReactNode);
  requirePermission?: boolean;
  title: string;
  description: string;
}) {
  const profile = useContext(ProfileContext);
  const { t } = useTranslation();
  // profile 三态：undefined=加载中、null=未登录、对象=已登录。
  // 加载中不能判为「无权限」，否则管理员进后台会先闪一下「权限不足」。
  const isProfileLoading = profile === undefined;
  const content = requirePermission && !isProfileLoading && !profile?.permission ? (
    <ErrorPage error={t("error.permission_denied")} />
  ) : (
    children
  );

  return (
    <Route path={path}>
      {(params) => (
        <AdminLayout title={title} description={description}>
          {typeof content === "function" ? content(params) : content}
        </AdminLayout>
      )}
    </Route>
  );
}

function TocRoute({
  path,
  children,
}: {
  path: PathPattern;
  children: (params: DefaultParams, toc: () => JSX.Element, cleanup: (id: string) => void) => ReactNode;
}) {
  const { TOC, cleanup } = useTableOfContents(".toc-content");

  return (
    <AppRoute path={path} headerComponent={TOCHeader({ TOC })} paddingClassName="mx-4">
      {(params) => children(params, TOC, cleanup)}
    </AppRoute>
  );
}
