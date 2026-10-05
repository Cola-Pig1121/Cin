# Docker 部署

Rin 可以打成单个镜像：一个容器、一个端口，同时提供 API 与前端页面。
不需要 Cloudflare 账号，也不需要 wrangler。

## 快速开始

```bash
# 1. 准备配置（可选，但强烈建议至少改 JWT_SECRET）
cp .env.docker.example .env

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
# http://localhost:23365
```

首次启动会自动执行数据库迁移，用 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

```bash
docker compose logs -f rin      # 看日志
docker compose restart rin      # 重启
docker compose down             # 停止
```

> **JWT_SECRET 必须改。** 它是签发登录令牌的密钥，不设置等于任何人都能伪造管理员会话。
> 生成方式：`openssl rand -hex 32`

## 数据存放

所有可变数据都在名为 `rin-data` 的卷里：

```
/app/data/rin.db        SQLite 数据库
/app/data/uploads/      上传的图片与附件
```

备份就是打包这个卷：

```bash
docker run --rm -v rin_rin-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/rin-data-$(date +%Y%m%d).tar.gz -C /data .
```

换回宿主机目录挂载也可以，路径随意：

```yaml
volumes:
  - ./data:/app/data
```

## 换端口

改 `.env` 里的 `RIN_HOST_PORT`，容器内端口固定 23365：

```bash
RIN_HOST_PORT=8080
```

## 镜像结构

Dockerfile 是三段式构建：

| 阶段 | 作用 |
|---|---|
| `deps` | 安装全部依赖（含 devDependencies，前端构建需要） |
| `build` | 构建前端产物到 `dist/client` |
| `run` | 保留运行时文件，跑在非 root 用户下 |

运行时用 `tini` 作为 PID 1，保证 `docker stop` 的 SIGTERM 能传到 Bun 进程，
从而优雅关闭（关掉数据库连接、排空队列）。

后端以 TypeScript 源码形式由 Bun 直接执行，所以镜像里保留了 `server/` 源码，
没有编译步骤。

容器启动走 `server/src/runtime/entrypoint.ts`：先跑一次幂等迁移，再启动 HTTP 服务。
迁移失败会直接退出，不会带着残缺表结构运行。

## 常用运维

```bash
# 查看容器状态与健康检查结果
docker compose ps

# 改完 .env 后重建
docker compose up -d --build

# 看实时日志
docker compose logs -f rin

# 进容器排查
docker compose exec rin sh

# 手动触发一次定时任务（友链检查 / RSS / Sitemap）
docker compose exec rin bun -e "
  const { runOnce } = await import('./server/src/runtime/local-queue.ts');
  console.log('see local-queue API');
"
```

健康检查每 30 秒请求一次 `/api/config`，返回 401 也算健康
（说明路由与鉴权中间件都正常）。

## 配 Artalk 评论

仓库里提供了一份把 Rin 与 Artalk 放在同一 Docker 网络的编排：

```bash
docker compose -f docker-compose.artalk.yml up -d
```

之后：

- Rin → http://localhost:23365
- Artalk → http://localhost:23366

创建 Artalk 管理员：

```bash
docker exec -it rin-artalk artalk admin
```

### 关键：容器内地址 vs 浏览器地址

Artalk 有两个地址，别搞混：

| 用途 | 地址 | 说明 |
|---|---|---|
| Rin 服务端探测连通性 | `http://artalk:23366` | 只在 Docker 网络内解析 |
| 浏览器加载评论 | `http://<宿主机IP>:23366` | 浏览器必须能打开 |

**填到 Rin 设置里的应该是浏览器能访问的那个**，因为 Artalk 的 JS 资源和 API
请求都由浏览器发起。填 `artalk:23366` 的话，浏览器解析不了这个主机名，
评论区会空白。

如果从宿主机用 `http://localhost:23365` 访问 Rin，那么 Artalk 地址填
`http://localhost:23366`。若通过局域网 IP 访问 Rin，则填
`http://192.168.x.x:23366`，同时要把 Artalk 后台里的站点地址也改成对应值。

配置位置：**设置 → 其他设置 → Artalk 评论**。填完点「测试连接」，
Rin 会从服务端请求一次 Artalk 的 `/api/v2/conf`，能返回即视为连通。

## 用 Supabase 而不是本地卷

数据与文件都放 Supabase 时，`.env` 里改：

```bash
RIN_RUNTIME=supabase
SUPABASE_DATABASE_URL=postgresql://...:6543/postgres

S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
S3_REGION=<project-region>
S3_BUCKET=<bucket 名>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=false
```

两点注意：

1. **先建表。** 在 Supabase SQL Editor 里执行一次
   `server/sql-postgres/0000-init.sql`。容器启动时不会自动建 PG 表，
   因为 `entrypoint` 明确跳过 supabase 模式的本地 SQL 迁移。
2. **卷可以不要。** 数据都在云端，`rin-data` 卷只存少量本地文件。
   但保留也无害，方便放临时文件。

## 镜像体积

构建上下文约几百 MB（含 bun.lock 与源码），最终镜像在 300MB 左右 ——
主要是 Alpine 基础镜像加运行时依赖。想进一步压缩可以换成
`oven/bun:1.3-alpine` 的 slim 变体或改用 distroless，但要注意
`pg` 与 `bun:sqlite` 都需要系统库支撑。

## 反向代理

放到 Nginx / Caddy 后面时，注意转发 `/api` 与静态资源，且要支持长连接
（本地 SQLite 是同步驱动，单进程足够，但 SSE 类请求需要关闭缓冲）：

```nginx
location / {
    proxy_pass http://127.0.0.1:23365;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`X-Forwarded-For` 会被用于 PV/UV 统计，缺失会导致所有访客被算成同一个 IP。
