---
title: Complete Admin Distribution 与 Thin Host
order: 2
description: v1.3.9 稳定 Admin 发行架构与 新仓库组件边界
---

# Complete Admin Distribution 与 Thin Host

## 当前版本范围

v1.3.9 是 `mss-boot-sys/mss-boot-admin` 的首次发行基线，v1.3.8 及更早版本属于
原 `mss-boot-io` 组织。安装和升级从[快速开始](/getting-started)进入，历史事实见
[发布归档](/releases)。

## 架构决策

v1.3.9 Admin Distribution 由 Root 工具、Framework、Admin、Admin Web 与 Blueprint
使用一个协调版本，同时保留独立发布身份。Docs 源码说明同一稳定基线，但网站发布是
独立异步链路，不属于 Distribution 的完整性或采用门禁。下游应用是 Thin Host，不是
Foundation 源码副本。

```text
cmd/server/main.go                 Admin 组合入口
internal/modules/<business>/       业务后端所有
web/src/business/                  业务前端所有
.mss/                              项目、模块、命令和锁合同
受管配置/构建胶水                  Blueprint 所有
```

Thin Host 不包含 Admin 核心路由、中间件、迁移、Framework、完整前端页面、Foundation
文档或发布工作流副本。

## 后端组合

`admin/app` 构造完整应用，`admin/business` 接收显式有序模块。模块注册在事务式
registry 中完成；迁移冲突、路由冲突、重入或部分注册失败必须 fail closed。所有业务
API 位于核心安全中间件后的受保护组中。

后端模块可以拥有前向迁移、模型、DTO、服务、受保护 API、权限、菜单投影与就绪检查；
它不能替换认证、会话、CSRF、核心路由或迁移 registry。正向和负向授权测试必须同时
证明允许与拒绝路径。

## 前端组合

完整发行只提供一个 Admin Web SPA。Thin Host 使用公开 preset、runtime 和 business
导出注册业务路由与菜单；核心路由先注册，业务扩展随后注册，403/404 回退最后注册。

业务页面覆盖 loading、empty、retryable error、denied、responsive 和 locale。浏览器
route guard 只改善体验，不能替代后端授权。完整包从 GitHub Packages 解析，安装需读取认证。

## Blueprint 与三方升级

v1.3.9 Root Release 将单一 Blueprint 源嵌入工具，并绑定版本、源提交、构建时间和仓库。
创建流程先产生只读计划，再检查路径与未知文件、原子写入受管文件、固定同一完整版本的
公共依赖，并写入 manifest、lock 与同源快照；第二次生成必须无差异。

三方升级比较：

```text
旧 Blueprint 基线 + 当前 Thin Host + 新完整版本基线
                         │
                         ▼
                 只读计划 / 冲突列表
                         │ 人工确认
                         ▼
                       应用
```

仓库必须保留 `.mss/blueprint-manifest.json`。手工拼装或基线丢失的仓库迁入由目标完整
版本生成的新 Thin Host，不得伪造摘要。应用只更新受管文件，保留业务和未知文件，最后
更新快照；再次计划必须为空。v1.3.5 缺少 Root 工具与完整包图，不能执行这条升级路径。

## 完整发布与公共验证

从同一个精确 merged-main 提交完成本地完整验证，再依次创建 Framework、Admin、
Admin Web 与 Root 正式 Tag。工作流校验来源并构建发布对应制品；Admin 在 Framework
公开后用 `GOWORK=off` 解析精确依赖。前端标签将 npm 包发布到 GitHub Packages，Root
发布工具、镜像与 GitHub Latest，无单独 npmjs 或稳定晋升步骤。

发布验证覆盖生成、升级、测试、构建、运行、权限和浏览器流程。Go 模块可公开解析，npm
下载使用只读 GitHub Packages 认证。最后发布 Docs 标签，保持现有域名并核对公开
`/release.json` 与真实页面。Docs 失败修复自身，不移动已发布核心身份。

源修复必须通过后续 PR 合入 `main`，重新选择精确提交并执行受影响验证。核心标签一旦
发布即不可变；后续组件修复使用未占用版本。

## mss-shop 证明

[mss-shop](/getting-started/mss-shop) 必须等待维护者显式选择的未使用完整版本，再提交
未修改生成基线并加入通用单租户商城模块。它验证包导入、业务所有权、升级、自动测试和
Codex 内置浏览器流程，而不是复制 R1Shop 或 Foundation。
