---
title: FAQ
order: 3
description: v1.6.1 当前发行、v1.3.5/v1.3.6 永久停止与 Docs 独立发布边界 FAQ
---

# FAQ

:::warning
版本范围：**v1.6.1 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
Docs 通过独立标签部署；网站延迟或失败不使已发布的不可变组件制品失效，但协调发行必须在生产 Docs 与 `/release.json` 验证通过后才算完成。
:::

## v1.6.1 现在可以安装或升级吗？

对应 Release 和包可用后，可按本页安装与升级。安装新工具和创建应用见
[快速开始](/getting-started)；升级现有 Thin Host 前必须备份代码、配置、数据库和业务数据，
并保留 `.mss/blueprint-manifest.json`。先核对工具，再执行只读计划、显式应用和最终空计划：

```shell
mss --version
mss-mcp --version
mss doctor --strict
mss upgrade admin v1.6.1
mss upgrade admin v1.6.1 --apply --yes
mss upgrade admin v1.6.1
mss verify --all
```

手工拼装或丢失 manifest 的仓库不能伪造基线；应先生成一个新的 v1.6.1 Thin Host，再按
所有权边界迁入规格、配置和业务文件。Docs 通过独立标签部署；网站延迟或失败不使已发布的不可变组件制品失效，但协调发行必须在生产 Docs 与 `/release.json` 验证通过后才算完成。

## 旧组织版本是否会补发到新仓库？

不会。v1.3.8 及以前的版本属于原 `mss-boot-io` 组织，保留历史记录和已知校验和。
v1.3.9 是新仓库首发，v1.6.1 是后续补丁发行。迁移前备份已安装的旧工具、依赖、镜像与数据库，避免回滚依赖
已经不可见的旧组织。

## 为什么不能从 npmjs 安装新包？

`@mss-boot-sys/admin-web@1.6.1` 仅发布到 GitHub Packages。配置 scoped registry，
通过 `NODE_AUTH_TOKEN` 注入具有 `read:packages` 权限的认证；不要向仓库写入令牌。
完整配置见[包与导入边界](/getting-started/packages)。

## 新仓库命名空间兼容旧导入吗？

需要迁移。业务代码中的旧 Go imports、npm scope、镜像仓库和构建认证都要更新。
引用 Casbin v2 类型的扩展还需适配 v3；重新验证允许、拒绝和租户隔离路径。
详见[v1.6.1 发布说明](/releases/v1-6-1)。

## 为什么采用者不再需要先克隆 Foundation？

v1.6.1 Root Release 的工具内置与版本、源提交和构建身份绑定的 Blueprint。采用者
从公开工具和包生成 Thin Host；Foundation checkout 只服务贡献者。

## 当前创建与升级流程怎样保护现有文件？

v1.6.1 工具默认先返回只读计划，验证目标目录、未知文件、公共包身份与冻结锁，再在显式
确认后原子写入。生成结果记录 Blueprint manifest 与同源快照，两次生成必须稳定；未知
文件和业务所有文件不得被静默覆盖。

## 初始管理员凭据合同是什么？

完整 Thin Host 的首次初始化使用隐藏输入；非交互自动化只向初始化进程注入一次性
`MSS_ADMIN_INITIAL_PASSWORD`。密码不进入参数、报告、生成文件或长期服务环境，只存
一向验证值。生成应用的初始用户名为 `admin`，本地地址为
`http://127.0.0.1:8001`，系统没有默认密码。该环境变量只允许提供给一次初始化进程，
不得留在长期服务环境中。

## 三方升级需要哪些前置条件？

目标完整发行的 Root 工具、Blueprint、Admin、Framework、Admin Web、GitHub Packages 包 与锁
必须同源；仓库还要保留 `.mss/blueprint-manifest.json`。升级前备份代码、配置、数据库
和业务数据，先评审只读计划，冲突清零后才应用，最后再次计划必须为空。

手工拼装或丢失 manifest 的仓库不能伪造摘要。它应迁入由目标完整版本生成的新 Thin
Host，再按所有权迁入规格和业务文件。v1.3.5 与 v1.3.6 不具备这些前置条件，因此没有
受支持的升级命令。

## 能否混用不同补丁版本？

不能。Admin、Framework、Admin Web、工具、Blueprint 和锁记录构成一个协调发行版。
混用版本会失去公共资格验证证据。

## 何时可以直接修改生成文件？

不要直接修改生成区。能由规格表达的变化先修改 `.mss/` 规格，再生成并运行漂移检查。
业务所有文件不在生成管理范围内，可以正常维护。

## 从哪里确认版本状态？

当前采用判断见[采用状态](/getting-started)，部分列车的不可变事实见
[v1.3.5 部分发布记录](/releases/v1-3-5) 与
[v1.3.6 部分发布记录](/releases/v1-3-6)，当前稳定记录见
[v1.6.1 发布说明](/releases/v1-6-1)。本地分支、PR 成功、一个标签或一个组件
可下载都不能单独证明完整发行。
