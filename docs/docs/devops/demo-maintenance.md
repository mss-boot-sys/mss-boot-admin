---
title: Demo 发布维护
order: 30
---

# Demo 发布维护

`https://demo.mss-boot-io.top` 的维护归属为 `mss-boot-sys/mss-boot-admin`。
后端使用独立的 `mss-admin-demo` 命名空间、`admin-demo` Deployment 和
`admin-demo-data` 持久卷；前端使用现有的 `mss-boot-admin` Cloudflare Worker。
本流程不操作 Agent Platform 的开发、生产环境，也不操作旧 demo 主机。

机器契约在 `.mss/features/demo-release-maintenance.yaml`，稳定部署参考清单在
`deploy/demo/admin-demo.yaml`，实现与故障测试在 `tools/demo/`。
这些文件取代平台仓库中原有的 demo 专属部署资料。当前数据来自已经完成的一次性
初始化，后续部署必须保留它；日常清单不包含初始化 Job。

## 自动触发与版本来源

`.github/workflows/demo-deploy.yml` 仅在 **Root Release 成功完成**后自动运行。
不使用各组件的 Release 事件，避免同一版本重复部署，也避免 `GITHUB_TOKEN`
创建 Release 不触发后续工作流的问题。工作流使用 `main` 中经过 PR 合并的维护代码，
不运行发布事件携带的任意脚本。

解析器等待有界时间，确认以下事实后才允许部署：

- Root、Framework、Admin、frontend 均为正式、非草稿 Release，标签指向同一提交。
- 该提交位于当前远程 `main` 历史中，五条对应发布流水线均成功，包括独立的容器发布。
- Root 的完整制品集合已就绪。
- 前端下载匹配 GitHub 资产摘要和 `SHA256SUMS.frontend-v6`；构建信息及
  `release.json` 中的版本、提交完全相同。归档不得包含路径穿越、链接或特殊文件。
- 官方 GHCR 镜像索引、两个 Linux 架构的清单和配置均按内容摘要校验，OCI
  版本、源码提交及仓库标签一致。部署只使用 `image@sha256:...`。

Docs 发布有独立生命周期，不重复触发 demo。没有新的源码构建或制品再发布。

## 已有环境的接入

GitHub 的 `demo` environment 只允许 `main` 分支。使用如下配置；不要把值写入
工作流、提交、命令日志或公开构建产物。

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `CF_API_TOKEN` | repository Secret | 已有 Cloudflare 受控令牌 |
| `DEMO_SSH_KEY` | demo Secret | demo 专用、强制命令 SSH 私钥 |
| `DEMO_ADMIN_PASSWORD` | demo Secret | 当前 demo 管理员登录验收 |
| `DEMO_SSH_HOST` | demo variable | demo 所在集群维护入口 |
| `DEMO_SSH_USER` | demo variable | 安装强制命令的服务器用户 |
| `DEMO_SSH_KNOWN_HOSTS` | demo variable | 经已有可信 SSH 连接核对的主机公钥 |

Cloudflare 需要读取 zone 和 Worker 路由、读取和上传 Worker 版本、创建 Worker
deployment 的权限。脚本没有 DNS 或路由写入操作。路由读取或版本上传权限不足会在停写前失败，切换阶段的 API 故障则执行事务回滚。
Node 使用 nvm 管理的 24，Wrangler 由 `tools/demo/package-lock.json` 固定。

服务器安装经评审的 `tools/demo/backend.py`，文件由 root 所有，部署密钥不能修改。
其专用 `authorized_keys` 条目必须使用 `restrict` 和固定的 Python 强制命令，禁止
交互 shell、端口转发、代理转发和 PTY。该入口只接受有界 JSON 请求，只允许
`prepare`、`deploy`、`commit`、`rollback`、`finalize-rollback`、`status`，所有 Kubernetes 命令固定到
demo 命名空间。不能把普通 root SSH 私钥交给 Actions。

服务器保留 `/var/lib/mss-admin-demo-maintenance`，权限为 `0700`；备份和状态文件为
`0600`。这里只由受控服务器入口保存数据库、上传文件和私有配置，Actions 收据只含
版本、摘要、阶段、备份大小等脱敏信息。后续修改服务器入口时，先合并 PR，再通过
已有维护访问安装对应合并提交的文件并核对摘要；部署密钥本身不能更新入口代码。

## 部署事务与数据保护

GitHub concurrency 保证流水线串行执行，服务器还有持久事务锁和每次调用的文件锁。
新事务不能覆盖未完成事务。新版本不得低于当前版本，同版本必须匹配相同源码和镜像。

1. 验证全部正式制品与线上路由，记录当前 Worker 版本，再上传新静态版本但不切流量。
2. 校验当前单副本 `Recreate` Deployment、独立持久卷和私有配置，停止应用并等待所有
   数据卷写入者退出；完整备份 SQLite、WAL、上传文件、迁移标记和配置。
3. 用候选摘要镜像在已有数据库上执行 `migrate` 和 `server -a`。不会提供
   `MSS_ADMIN_INITIAL_PASSWORD`，不会创建初始管理员、替换数据库或重建 PVC。
4. 更新后端镜像和迁移标记，等待 rollout、二进制身份、健康和就绪检查成功。
5. 将前端切换到暂存的不可变 Worker 版本，执行公网验收，再提交服务器事务。

迁移失败、后端启动失败、Cloudflare 切换失败或公网验收失败都会触发恢复：使用
同一事务保存的旧 Worker 版本、后端 Deployment、完整数据卷和配置。
恢复先停止应用，不能让旧二进制直接运行在已迁移的新数据库上。
备份成功前发生失败只恢复原有运行状态，不能使用不完整备份。恢复数据后重启独立的
demo 缓存以清除候选版本的临时状态；旧版本的公网登录和协议验收通过后，才通过
`finalize-rollback` 释放服务器事务锁。前端恢复失败会保留锁，禁止后续部署覆盖。

单节点 SQLite 部署在备份和迁移期间会有短暂停机。上线后、验收完成前的少量写入可能
在回滚时被恢复点覆盖，因此 demo 不应存放不可丢失的业务数据。备份含私有数据，不能
作为公开 Actions artifact 上传。容量和保留期由维护者定期检查，流水线不自动删除备份。

## 同源与路由边界

每次部署前后都检查如下精确路由，任何漂移都会停止验收。主路由仍是静态 Worker，
六条例外直达已有后端。脚本不重建或覆盖它们。

| 路由 | 处理方式 |
| --- | --- |
| `demo.mss-boot-io.top/*` | `mss-boot-admin` Worker |
| `demo.mss-boot-io.top/admin/*` | 不使用 Worker |
| `demo.mss-boot-io.top/admin` | 不使用 Worker |
| `demo.mss-boot-io.top/public/*` | 不使用 Worker |
| `demo.mss-boot-io.top/healthz` | 不使用 Worker |
| `demo.mss-boot-io.top/readyz` | 不使用 Worker |
| `demo.mss-boot-io.top/.well-known/acme-challenge/*` | 不使用 Worker |

保持 `workers_dev: false`、`preview_urls: false`、`html_handling: none` 和
`not_found_handling: single-page-application`。只排除构建统计文件并添加响应头，应用
静态字节来自官方归档。

公网检查包括首页与登录/回调深链接、静态资源字节（仅识别并排除现有 Cloudflare 边缘注入的统计脚本）、版本、登录、用户信息、Secure
且仅当前主机有效的会话 Cookie、匿名拒绝、CSRF 拒绝、外部 Origin 拒绝、WebSocket
升级、一次性 ticket 重放拒绝和退出。维护者在内置浏览器补充实际页面验收。

## 手动重试和恢复

从 GitHub Actions 的 **Deploy Demo** 页面选择 `main`，输入已经发布的精确版本。
正常重试用新的运行编号；同一版本仍要通过完整制品和数据保护检查。也可执行：

```sh
gh workflow run demo-deploy.yml --repo mss-boot-sys/mss-boot-admin --ref main -f version=v1.6.1
```

本地先执行只读计划，输出仅限仓库 `.mss/run`：

```sh
python3 tools/demo/resolve_release.py --version v1.6.1 \
  --output .mss/run/demo/release.json --assets-dir .mss/run/demo/assets --write
python3 tools/demo/deploy.py --release .mss/run/demo/release.json \
  --state-dir .mss/run/demo/transaction --transaction manual-review
```

只有显式 `--apply` 才执行部署；实际环境值通过私有环境注入。发生中断时先查
服务器事务状态和 Actions 的脱敏 `receipt.json`，恢复未完成事务后再启动新部署。
保留同一事务收据，在相同私有环境中运行：

```sh
python3 tools/demo/deploy.py --state-dir .mss/run/demo/transaction --rollback --apply
```

如果 CI 运行器丢失，先恢复下载的脱敏收据到新的仓库 `.mss/run` 事务目录，再用该
命令恢复。若 Cloudflare 或集群仍不可达，事务保持未完成状态，流水线报告失败并禁止
后续覆盖；维护者恢复连接后继续同一事务，不删除锁或重新初始化数据。

## 验证命令

```sh
python3 -m unittest discover -s tools/demo -p 'test_*.py'
python3 -m unittest tools.release.test_workflow_governance
go run ./cmd/mss verify --changed
pnpm --dir docs build
```

接入完成以实际成功的 GitHub Actions 运行、持久卷与配置保留证据、脱敏收据和内置
浏览器验收为准。仅有示例配置或只读计划不能代表已接通。
