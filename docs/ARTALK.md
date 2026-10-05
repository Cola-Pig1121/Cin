# Artalk 评论接入

Rin 的评论功能已接入 [Artalk](https://github.com/ArtalkJS/Artalk)，
评论数据由 Artalk 独立存储，与文章数据相互独立。

## 架构

```
浏览器 ──> Rin 前端 ──> Rin 后端（文章数据，SQLite/Postgres）
   │
   └──────> Artalk 服务端（评论数据，独立数据库）
```

要点：**评论不经过 Rin 后端**。Rin 只在文章页挂载 Artalk 的客户端组件，
之后读写评论全由浏览器直接与 Artalk 通信。这样 Rin 不用存评论表，
Artalk 也不用知道文章的存在。

## 配置

位置：**管理后台 → 设置 → 其他设置 → Artalk 评论**

| 配置项 | 说明 |
|---|---|
| 启用评论 | 总开关。关闭后文章底部不显示评论区 |
| 评论后端 | `Artalk` 或 `Rin 内置` |
| Artalk 服务器地址 | 需带协议与端口，如 `http://192.168.21.250:23366` |
| 站点名 | 需与 Artalk 后台里的站点名一致，留空则用本站名称 |
| 页面键前缀 | 决定评论挂在哪个页面下，默认 `/post` |
| 深色模式 | `inherit` 跟随本站主题，`light` / `dark` 固定 |

配置存在 `clientConfig`（随站点公开下发），保存后刷新页面即生效。

改完点「测试连接」，Rin 会从**服务端**请求 Artalk 的 `/api/v2/conf`，
能返回配置即视为连通。从服务端发请求是有意为之 ——
这样能验证浏览器访问不到的内网地址，比如 Docker 网络里的 `artalk:23366`。

## 服务器地址该填什么

这是最容易踩的坑。Artalk 有两个地址，取决于谁访问它：

| 谁在访问 | 用哪个地址 | 例子 |
|---|---|---|
| 浏览器加载评论 JS 与发评论 | 浏览器能打开的地址 | `http://192.168.21.250:23366` |
| Rin 服务端测试连通性 | 任意可达地址 | 同上，或 `http://artalk:23366` |

**设置里填的是浏览器要用的那个。** 填 `artalk:23366` 这类 Docker 内部域名，
浏览器解析不了，评论区会空白 —— 但「测试连接」却能通过，因为服务端解析得了。
两个结果的组合正好能帮你区分这两种故障。

如果你的 Rin 和 Artalk 都在 Docker 里，用 compose 把它们放同一网络，
然后填宿主机映射出去的地址（`http://<宿主机IP>:23366` 或 `http://localhost:23366`）。
具体见 [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md#配-artalk-评论)。

## 必做：把站点加入 Artalk 的信任域

Artalk 默认**不允许跨域访问**。如果这一步没做，评论区会显示：

```
Artalk Error
Failed to load comments
TypeError: Failed to fetch
```

这是最常见的接入失败原因。注意它的迷惑性：Rin 侧的「测试连接」**会通过**
（服务端到 Artalk 是同源直连），只有浏览器会失败。

解决办法 —— 在 Artalk 后台把 Rin 的地址加进信任域：

1. 打开 Artalk 后台（`http://192.168.21.250:23366`）
2. 进入左侧「站点」标签，选中对应站点，点「修改 URL」
3. 填入 Rin 的访问地址，**多个用逗号分隔**：
   ```
   http://localhost:23365, http://192.168.21.250:23365
   ```
4. 保存后**手动重启 Artalk**（配置改动不会热加载）

也可以直接改配置文件：

```yaml
trusted_domains:
  - http://localhost:23365
  - http://192.168.21.250:23365
```

或用环境变量（会覆盖配置文件里的值）：

```bash
ATK_TRUSTED_DOMAINS="http://localhost:23365 http://192.168.21.250:23365"
```

**端口必须写。** Artalk 只比对到端口，访问 `http://192.168.21.250:23365` 就得
写 `http://192.168.21.250:23365`，只写主机名不算匹配。

`ATK_SITE_URL` 配置项会被自动加入信任域，所以部署 Artalk 时填的站点地址
也一并生效。

## 排查对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| 评论区空白，无任何提示 | 服务器地址填成了容器内域名，浏览器解析不了 | 换成浏览器能打开的地址 |
| `Artalk Error / Failed to fetch` | Rin 的地址不在 Artalk 信任域里 | 见上一节，加 `trusted_domains` |
| 「测试连接」失败 | Artalk 服务不可达 | 检查地址、端口、防火墙 |
| 换了地址后评论都不见了 | 页面键前缀变了 | 改回原前缀，见下节 |
| 评论显示为「待审核」 | Artalk 后台开启了评论审核 | 在后台放行，或调整审核策略 |


## 页面键与评论归属

Artalk 用「页面键」（pageKey）识别一篇文章，Rin 传的是：

```
{页面键前缀}/{文章ID}     默认即 /post/123
```

用文章 ID 而不是 alias，是因为 alias 可以改，而 Artalk 的页面键一旦确定
就不会跟着变。改 alias 不会丢评论，改页面键前缀会。

已有 Artalk 实例若想沿用旧的评论归属，需要在 Artalk 后台做数据迁移；
从 Rin 内置评论切到 Artalk 的话，Rin 侧的历史评论不会自动搬过去 ——
`comments` 表仍然保留，切回「Rin 内置」即可继续看到。

## 登录态

Artalk 有自己的账号体系，与 Rin 的登录不互通：

- 想让用户在 Rin 登录后免登录评论，需要在 Artalk 后台开启
  「用户认证」并配置第三方登录
- 未配置时，Artalk 会要求访客填写昵称与邮箱
- Artalk 管理员在评论框输入后台的邮箱后会看到「管理」按钮

## 深色模式

`inherit` 会跟随本站的明暗主题切换，站点切换时会同步更新。
固定 `light` 或 `dark` 则始终用同一种外观。

Rin 的主题色不会被 Artalk 采纳 —— Artalk 有自己的配色方案，
靠 `frontend_conf` 控制。如果要完全统一外观，可以在 Artalk 后台调整其配置。

## 数据与备份

评论存在 Artalk 自己的数据库里。如果用官方 `artalk/artalk-go` 镜像，
数据在容器的 `/data` 目录，备份它即可：

```bash
docker run --rm -v rin_artalk-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/artalk-data.tar.gz -C /data .
```

## 切回内置评论

如果 Artalk 那边出问题了，把设置里的「评论后端」改成 `Rin 内置` 即可。
Rin 原来的评论表和接口都还在，没有被删除。

## 参考

- [Artalk 文档](https://artalk.js.org/)
- [Artalk 部署](https://artalk.js.org/guide/deploy.html)
- [Artalk 前端配置](https://artalk.js.org/guide/frontend/config.html)
- [Artalk 数据迁移](https://artalk.js.org/guide/transfer.html)
