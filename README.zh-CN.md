# mss-boot 完整 Admin 发行版

[English](./README.md)

mss-boot 是面向 Agent 的管理系统基础设施。**v1.5.0 是
`mss-boot-sys/mss-boot-admin` 的当前完整 Admin Distribution**（v1.3.9 为本仓库首发）。 v1.3.8 及更早版本
发布于原 `mss-boot-io` 组织；保留历史记录，不在新仓库补建旧标签或制品。

以下命令说明 v1.5.0 发行合同，适用于对应
[Release](https://github.com/mss-boot-sys/mss-boot-admin/releases/tag/v1.5.0)
和包可用之后。所有组件绑定同一个经过完整本地验证的 merged `main` 提交；实际发布状态
以 Release、包和镜像资产为准。

## Distribution 身份

| 发布面 | v1.5.0 身份 |
| --- | --- |
| Root 工具、后端镜像与 GitHub Release | `v1.5.0` |
| 可复用 Go Framework | `mss-boot/v1.5.0` |
| 可导入 Admin Go Module | `admin/v1.5.0` |
| 完整 Admin Web | `web/antd-v6/v1.5.0` / `@mss-boot-sys/admin-web@1.5.0` |
| Docs 网站 | `docs/v1.5.0`，继续使用 https://docs.mss-boot-io.top |

Admin Web 仅发布到 GitHub Packages（`npm.pkg.github.com`），下载需要 GitHub 认证。
Docs 部署以公开 `/release.json` 中的版本与完整提交以及页面实测为准。

## 安装 v1.5.0 工具

版本化安装器会校验 Release 摘要并同时安装 `mss` 与 `mss-mcp`；它不会使用 `sudo`，
也不会修改 Shell Profile。

Linux 或 macOS：

```shell
curl -fL -o install-mss.sh \
  https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.5.0/install-mss.sh
bash ./install-mss.sh --version v1.5.0
export PATH="$HOME/.local/bin:$PATH"
mss --version
mss-mcp --version
```

Windows PowerShell：

```powershell
Invoke-WebRequest `
  https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.5.0/install-mss.ps1 `
  -OutFile install-mss.ps1
& .\install-mss.ps1 -Version v1.5.0
$env:Path = "$env:LOCALAPPDATA\Programs\mss\bin;$env:Path"
mss --version
mss-mcp --version
```

## 使用发行组件

Go 与 npm 依赖必须精确锁定协调版本。Admin Module 没有提交本地 `replace`。
前端需先按[包指南](./docs/docs/getting-started/packages.md)配置 GitHub Packages 认证。请在**已有外部 consumer module 的根目录**（即包含
`go.mod` 的目录）运行 Go 命令；空目录公共解析请使用[外部消费者步骤](./docs/docs/getting-started/packages.md)。
npm 命令必须另在**已有 frontend package 的根目录**（即包含 `package.json` 的目录，
Thin Host 中通常为 `web/`）运行。

Go Module 根目录：

```shell
go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.5.0
go get github.com/mss-boot-sys/mss-boot-admin/admin@v1.5.0
```

Frontend package 根目录：

```shell
corepack pnpm@10.34.5 add --save-exact @mss-boot-sys/admin-web@1.5.0
```

Thin Host 固定精确版本。通过本机秘密存储注入具有 `read:packages` 权限的
`NODE_AUTH_TOKEN`，不要提交令牌；生成的 `.npmrc` 只保留作用域 registry 与环境变量引用。

## 创建并启动 Thin Host

请从空的目标父目录调用公开工具，不要依赖 Foundation 源码检出：

```shell
mss new app orders-admin --module github.com/acme/orders-admin --repository acme/orders-admin --destination ./orders-admin --write --git-init

cd orders-admin
mss doctor --strict
mss setup
mss dev --detach
```

首次交互式 setup 会隐藏输入初始管理员密码。非交互自动化只能从密钥存储向单次
`mss setup` 进程注入 `MSS_ADMIN_INITIAL_PASSWORD`；不得把它放入参数、报告、生成文件、
依赖安装子进程或长期服务环境。初始化完成后，打开 `http://127.0.0.1:8001`，使用用户
`admin` 和刚设置的密码登录；项目没有默认密码。

## 升级 Thin Host

本次需要将业务自有 Go 导入从 `github.com/mss-boot-io/mss-boot-admin` 迁到
`github.com/mss-boot-sys/mss-boot-admin`，npm 作用域迁到 `@mss-boot-sys` 并配置 registry
认证。Go 基线为 1.27.2；引用 Casbin 类型的扩展须适配 Casbin v3 并重新编译验证。

先备份代码、配置和数据库，安装目标 v1.5.0 工具，并在规划前核对两个二进制版本。
受支持的三方升级必须保留生成的 `.mss/blueprint-manifest.json`：

```shell
mss --version
mss-mcp --version
mss upgrade admin v1.5.0 --format json
mss upgrade admin v1.5.0 --apply --yes --format json
mss doctor --strict
mss verify --all
mss upgrade admin v1.5.0 --format json
```

第一次和最后一次命令都是只读计划；最终计划不得包含 create、update、delete 或 conflict。
升级引擎只修改 Blueprint 管理文件，并保留业务自有文件和未知文件。手工拼装或缺少
manifest 的仓库必须在新目录生成干净的 v1.5.0 基线，再迁入业务规格和自有文件，不能
伪造 manifest。

## 架构边界

生成应用是 **Thin Host**：它导入完整 Admin Go Module 与 Admin Web 包，只持有组合胶水
和业务模块，不复制 Foundation 核心源码。后端业务模块在编译期注册，前端业务路由扩展
已发布应用壳，后端授权始终是最终权威。

运行时动态模型、虚拟 CRUD 和浏览器代码生成保持移除。结构化 Feature 与 AdminModule
规格驱动开发期确定性生成，并形成可审查的迁移、权限、菜单、前端、测试与 Agent Eval
契约。

## 人类文档与 Agent 指令

仓库明确区分解释性文档与 Agent 可执行权威：

| 受众 | 入口 |
| --- | --- |
| 采用者、运维和贡献者 | README 与 `docs/docs/**` |
| 架构维护者 | `docs/adr/**` |
| Foundation AI Agent | 最近的 `AGENTS.md` -> `.mss/**` -> 对应 `.agents/skills/**` |
| 生成 Thin Host AI Agent | 生成仓库自己的 `AGENTS.md`、`.mss/**` 与本地 Skills |

公开的 [Agent 协作说明](./docs/docs/agent/index.md)面向人类解释这套模型，不是 Agent
可执行指令源。采用者请从[快速开始](./docs/docs/getting-started/index.md)、
[包边界](./docs/docs/getting-started/packages.md)、
[工具契约](./docs/docs/getting-started/tooling.md)与
[v1.5.0 发布记录](./docs/docs/releases/v1-5-0.md)开始。

Foundation 贡献者应按 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 与最近的
`AGENTS.md` 使用源码检出命令和验证流程。

## 许可证与安全

项目使用 [MIT License](./LICENSE)。安全问题请按
[`SECURITY.md`](./SECURITY.md) 的私密流程报告，不要提交公开 Issue。
