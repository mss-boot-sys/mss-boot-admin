---
title: 快速开始
order: 1
nav:
  title: 快速开始
  order: 1
description: 使用 v1.4.0 发行版工具创建、初始化、验证和升级 MSS Thin Host
keywords: [v1.4.0 stable quick start thin host mss upgrade]
---

# v1.4.0 快速开始

**v1.4.0 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首发）。 v1.3.8 及更早版本
属于原 `mss-boot-io` 组织；本页命令用于对应 Release 和包可用之后。Go 模块、Root
工具、前端包和镜像必须使用同一版本，不能混用旧命名空间。

Admin Web 仅发布到 GitHub Packages。执行 `mss new app`、`mss setup` 或升级前，先按
[包与认证指南](/getting-started/packages)配置 `read:packages` 认证，并通过
`NODE_AUTH_TOKEN` 注入。Docs 继续使用原域名，以公开 `/release.json` 核验部署身份。

## 1. 安装正式工具

从 [Root v1.4.0 Release](https://github.com/mss-boot-sys/mss-boot-admin/releases/tag/v1.4.0)
下载对应平台的安装器。安装器会先校验 Release 中的 SHA-256 清单，再原子替换 `mss`
与 `mss-mcp`，不会使用 `sudo` 或改写 shell 配置。

Linux 或 macOS：

```shell
curl --fail --location --remote-name \
  https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.4.0/install-mss.sh
bash install-mss.sh --version v1.4.0
export PATH="$HOME/.local/bin:$PATH"
```

Windows PowerShell：

```powershell
Invoke-WebRequest `
  -Uri https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.4.0/install-mss.ps1 `
  -OutFile install-mss.ps1
./install-mss.ps1 -Version v1.4.0
$env:Path = "$env:LOCALAPPDATA\Programs\mss\bin;$env:Path"
```

确认两个工具都报告 v1.4.0 以及同一个完整源提交：

```shell
mss --version
mss-mcp --version
```

## 2. 从空目录创建 Thin Host

先让命令输出只读计划，确认名称、Go Module、目标路径和文件清单；再显式写入：

```shell
mss new app example-admin --module github.com/example/example-admin --destination ./example-admin
mss new app example-admin --module github.com/example/example-admin --destination ./example-admin --write --git-init
cd example-admin
```

生成仓库只持有组合胶水、业务规格与业务代码；Admin、Framework 与
`@mss-boot-sys/admin-web@1.4.0` 均固定为公共 v1.4.0 依赖。不要复制 Foundation
源码、提交 `replace`，或用本地 tarball 替代 GitHub Packages 正式版本。

## 3. 初始化并首次登录

先检查环境，然后安装精确锁定的依赖并初始化本地数据库：

```shell
mss doctor --strict
mss setup
mss dev --detach
```

首次迁移会在交互式终端使用隐藏输入询问管理员密码。非交互自动化只能从密钥存储向
该次 setup/migrate 进程注入一次性 `MSS_ADMIN_INITIAL_PASSWORD`；密码不得放入命令
参数、配置、日志、报告、生成文件或长期服务环境。密码长度为 8-128 位，且至少包含一个
字母和一个数字。迁移成功后应删除该环境变量，重复初始化不再需要它，也不存在默认密码。

打开 `http://127.0.0.1:8001`，用户名使用 `admin`，密码是刚才设置的值。后端默认地址为
`http://127.0.0.1:8080`。可用 `mss dev status`、`mss dev logs <service>` 和
`mss dev stop` 查看或停止后台服务。

## 4. 日常验证

在提交业务变更前运行：

```shell
mss doctor --strict
mss verify --all
```

权限必须由后端执行；前端菜单或按钮隐藏只是体验层。业务页面应覆盖加载、空、错误和
拒绝状态，中英文文案保持同步。更细的 Agent 协作边界见[Agent 协作起步](/agent/getting-started)。

## 5. 升级到 v1.4.0

升级前先**备份** Git 仓库、配置、数据库和业务数据，并演练恢复。安装目标 v1.4.0
工具后，确认两个二进制的版本与源提交相同，并确认仓库仍有
`.mss/blueprint-manifest.json`。然后依次执行只读计划、显式应用、验证和最终 no-op：

```shell
mss --version
mss-mcp --version
mss upgrade status --format json
mss upgrade admin v1.4.0 --format json
mss upgrade admin v1.4.0 --apply --yes --format json
mss doctor --strict
mss verify --all
mss upgrade admin v1.4.0 --format json
```

第一次 `mss upgrade admin v1.4.0` 只生成三方合并计划。逐项处理冲突后才能执行第二条
应用命令；业务自有文件和未知文件必须被保留。最后一次
`mss upgrade admin v1.4.0` 必须没有 create、update、delete 或 conflict 操作，允许只读
的 `preserve` 说明。

手工拼装或丢失 manifest 的仓库不能直接三方升级。请在独立空目录用 v1.4.0 工具生成
干净 Thin Host，只迁移业务规格、业务自有代码、配置意图和数据；不要复制或伪造其他
仓库的 `.mss/blueprint-manifest.json`。

## 6. 回退边界

出现问题时恢复一套完整匹配的代码、配置、依赖锁、数据库快照和业务数据，不要只回退
某一个包。已发布的 v1.4.0 Tag、Release、npm 版本和镜像 digest 都是不可变身份；修复
应进入新的补丁版本，不能移动标签或覆盖制品。Docs 网站故障只处理网站部署，不触发
组件降级。
