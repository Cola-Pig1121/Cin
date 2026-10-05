# Rin Docker 镜像
#
# 单镜像包含前端产物与后端服务，一个进程、一个端口同时提供 API 与静态资源，
# 无需 wrangler 或 Cloudflare 账号。
#
# 构建分三段：
#   deps  —— 安装全部依赖（含 devDependencies，前端构建需要）
#   build —— 构建前端产物到 dist/client
#   run   —— 只保留运行时所需文件

# ---- 依赖安装 ----
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app

# 依赖清单单独拷贝，源码变动不会让这一层缓存失效
COPY package.json bun.lock bunfig.toml* ./
COPY cli/package.json ./cli/
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/ui/package.json ./packages/ui/

RUN bun install --frozen-lockfile

# ---- 构建前端 ----
FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages ./packages
COPY client ./client

# 客户端配置在运行时从服务端读取，构建期不需要真实值
RUN cd client && bun run build

# ---- 运行时 ----
FROM oven/bun:1.3-alpine AS run
WORKDIR /app

ENV NODE_ENV=production \
    RIN_RUNTIME=local \
    RIN_DATA_DIR=/app/data \
    RIN_CLIENT_DIST=/app/dist/client \
    BACKEND_PORT=23365

# tini 负责转发信号，保证 SIGTERM 能到达 Bun 进程从而优雅关闭
RUN apk add --no-cache tini

# 生产环境只需 server 的运行时依赖，但 @rin/* 是 workspace 包，
# 保留完整依赖树比逐个拷贝 workspace 更不容易出错
COPY package.json bun.lock ./
COPY cli/package.json ./cli/
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/ui/package.json ./packages/ui/

RUN bun install --frozen-lockfile --production \
    && rm -rf /root/.bun/install/cache

# 服务端以 TypeScript 源码形式由 Bun 直接执行，因此需要源码而非编译产物
COPY tsconfig.base.json ./
COPY packages ./packages
COPY server ./server
COPY cli ./cli

# 前端构建产物
COPY --from=build /app/dist ./dist

# 数据目录（SQLite 与上传文件）通过卷挂载，这里先建好并交给非 root 用户
RUN mkdir -p /app/data/uploads \
    && addgroup -g 1001 -S rin \
    && adduser -u 1001 -S rin -G rin \
    && chown -R rin:rin /app/data

USER rin

EXPOSE 23365

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.BACKEND_PORT || 23365) + '/api/config'); process.exit(r.status < 500 ? 0 : 1)"

ENTRYPOINT ["/sbin/tini", "--"]

# 启动前先跑一次幂等迁移，保证首次启动即有完整表结构
CMD ["bun", "server/src/runtime/entrypoint.ts"]
