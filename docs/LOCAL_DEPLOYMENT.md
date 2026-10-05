# 本地部署指南

Rin 原本只运行在 Cloudflare Workers 上，这套工具链（wrangler + workerd + D1 + R2 + Queues）
要求有 Cloudflare 账号才能跑起来。本地部署把平台能力换成本地实现，同一套业务代码
不改一行即可跑在你自己的机器上。

原有部署方式完全保留，两种运行时用 `RIN_RUNTIME` 切换。

## 运行时对照

| 能力 | cloudflare（默认） | local | supabase |
|---|---|---|---|
| 数据库 | D1（SQLite） | 本地 SQLite 文件 | Supabase Postgres |
| 文件存储 | R2 / S3 | 本地磁盘目录 | Supabase Storage（S3 协议） |
| 任务队列 | Cloudflare Queues | 进程内队列 | 进程内队列 |
| 定时任务 | Cron Triggers | setInterval | setInterval |
| 运行容器 | workerd | Bun 原生 HTTP | Bun 原生 HTTP |
| CLI | `rin dev` / `rin deploy` | `rin start` | `rin start -r supabase` |

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 准备配置
cp .env.example .env.local
```

`.env.local` 至少需要一项，其余有合理默认值：

```bash
RIN_RUNTIME=local
JWT_SECRET=换成任意长字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

> `JWT_SECRET` 必填，否则登录与后台会话校验会直接失败。
> 管理员账号在首次登录时自动创建。

```bash
# 3. 初始化数据库（建表 + 迁移）
bun run setup:local

# 4. 启动
bun run start:local
```

数据库文件会创建在 `data/rin.db`，启动日志会打印实际路径。

## 开发模式

前后端分离启动，与 Cloudflare 下的开发体验一致：

```bash
bun run start:local:client
```

- 前端：http://127.0.0.1:11499（Vite，热更新）
- 后端：http://127.0.0.1:11498

Vite 通过已有的 proxy 配置把 `/api` 转发到后端，无需额外配置。

## 生产模式（单进程托管前端）

先构建前端产物，再启动后端，本地服务会直接托管 `dist/client`：

```bash
bun run build:client
bun run start:local
```

之后访问 http://127.0.0.1:11498 就是完整站点，前端路由（`/timeline`、`/admin/settings` 等）
会回退到 `index.html`，与 Cloudflare 上的 SPA 行为一致。

## 目录约定

| 路径 | 内容 | 是否入 git |
|---|---|---|
| `data/rin.db` | SQLite 数据库 | 否（已加 .gitignore） |
| `data/uploads/` | 上传的图片 | 否 |
| `data/cache/` | S3 模式下的缓存文件 | 否 |

备份直接复制整个 `data/` 目录即可。

路径都可以在 `.env.local` 里改：

```bash
RIN_DATA_DIR=/var/lib/rin
RIN_DB_FILE=/var/lib/rin/rin.db
RIN_UPLOAD_DIR=/var/lib/rin/uploads
RIN_CLIENT_DIST=/srv/rin/dist/client
```

## 用 Supabase 作为后端

Supabase 同时提供 Postgres 和 S3 兼容的 Storage，正好对应 Rin 的两层存储需求。
Rin 不使用 Supabase SDK，只用标准协议，因此也适用于任何 S3 兼容服务。

### 1. 建表

在 Supabase SQL Editor 中执行一次：

```
server/sql-postgres/0000-init.sql
```

表名、列名与 SQLite 版完全一致，所以是全新库，不需要跑增量迁移。

### 2. 取连接串与密钥

在 Project Settings → Database 取连接串。建议用连接池器地址（端口 6543），
直连（5432）在长时间运行后容易耗尽连接。

在 Project Settings → Storage → S3 配置 生成一对 access key。

### 3. 配置

```bash
RIN_RUNTIME=supabase
SUPABASE_DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres

# 文件走 Supabase Storage 的 S3 兼容端点
S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
S3_REGION=<project-region>
S3_BUCKET=<bucket 名>
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
S3_FORCE_PATH_STYLE=false
S3_ACCESS_HOST=
```

`S3_ACCESS_HOST` 留空时图片通过 `/api/blob/<key>` 读取，省去 CDN 配置；
填了则直接返回该域名的直链。

### 4. 启动

```bash
bun run start:local -r supabase
```

### 数据如何存放

- 文章、评论、动态、标签、配置、缓存 → Supabase Postgres 的 `public` schema
- 图片与附件 → Supabase Storage 中 `S3_BUCKET` 指定的 bucket

SQLite 与 Postgres 的差异（自增主键、`timestamptz`、0/1 开关列）已在
`server/src/db/schema.postgres.ts` 中对齐，上层业务代码不做区分。

## 定时任务

友链健康检查、RSS 与 Sitemap 生成在 Cloudflare 上由 Cron Triggers 驱动，
本地改为进程内定时器，默认每 20 分钟一次，与线上的 cron 表达式一致。

```bash
CRON_INTERVAL_MS=300000   # 改成 5 分钟，便于验证
```

任务在服务启动时立即开始，之后按间隔重复。进程重启会重置计时。

## 已知差异

这几处是运行时实现不同导致的，不是缺陷，但行为上值得知道：

**队列不持久化。** 本地队列在进程内存中，重启会丢失未处理的任务。
AI 摘要任务在入队时已把文章状态写成 `pending`，重启后到
`/admin/compat-tasks` 点一次「补齐 AI 摘要」即可重新入队。
Cloudflare Queues 有持久化保证，没有这个问题。

**队列串行执行。** 本地一次只处理一个任务，避免并发写同一篇文章。
Cloudflare 侧 `max_batch_size = 1`，行为基本一致，但云端可以横向扩展。

**`scheduled` 触发时机不同。** Cloudflare 的 cron 在整点触发，
本地是「启动时立刻跑一次 + 此后按间隔」。首次启动会立即执行一轮，
不必等到第一个 20 分钟。

**健康检查项有差异。** `/admin/health` 检查的是配置完整性与平台依赖。
本地运行时没有 D1 绑定、Queues 绑定，部分 Cloudflare 相关项的判断与线上不同，
这是预期行为。

## 常用命令

```bash
bun run setup:local                          # 检查配置 + 初始化数据库
bun run start:local                          # 启动后端
bun run start:local:client                   # 后端 + 前端开发服务器
bun cli/bin/rin.ts start --port 8080          # 换端口
bun cli/bin/rin.ts start --skip-migrate       # 跳过迁移启动
bun cli/bin/rin.ts start -r supabase          # Supabase 模式
bun cli/bin/rin.ts start --client            # 显式指定开发模式

bun cli/bin/rin.ts                           # 查看完整命令列表
```

> npm script 会自动透传参数，也可以写成
> `bun run start:local --port 8080`。

## 常见问题

**端口被占用**

```bash
bun run start:local -- --port 8080
```

**数据库结构不完整**

删掉 `data/rin.db` 重新初始化：

```bash
rm -f data/rin.db*      # Windows: 用资源管理器删除
bun run setup:local
```

**图片上传报 `S3_ENDPOINT is not defined`**

说明 `RIN_STORAGE_BACKEND` 被设成了 `s3` 但没填 S3 配置。
想用本地磁盘就把它改成 `local` 或直接删掉这一行。

**登录提示 500**

多半是 `JWT_SECRET` 没配。检查 `/admin/health` 的「认证运行环境」项。

**Supabase 连接报 prepared statement 错误**

连的是直连地址而非连接池器。换成端口 6543 的连接串。
