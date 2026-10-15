---
title: mss-boot Admin
hero:
  title: mss-boot Admin
  description: v1.6.1 · SSO 未配置状态修复 · 完整 Admin 发行版
  actions:
    - text: 快速开始
      link: /getting-started
    - text: v1.6.1 发布与迁移
      link: /releases/v1-6-1
    - text: GitHub Packages 配置
      link: /getting-started/packages
features:
  - title: 完整发行
    emoji: 📦
    description: Go Framework、Admin、完整前端、工具与镜像使用同一 v1.6.1 基线。
  - title: 新仓库
    emoji: 🏠
    description: 代码与包迁至 mss-boot-sys，旧组织版本保留为历史记录。
  - title: Agent 协作
    emoji: 🛠️
    description: 规格、确定性生成、验证与三方升级形成可审查的工作流。
---

# mss-boot Admin

**v1.6.1 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.4.0 为首发）。 v1.3.8 及更早版本
发布于原 `mss-boot-io` 组织。当前指南统一使用新 Go 模块路径、GitHub Packages 上的
`@mss-boot-sys/admin-web` 和新镜像地址。

安装前阅读[快速开始](/getting-started)与[包认证指南](/getting-started/packages)。
v1.6.1 修复 SSO Provider 未启用时的管理页面状态，不新增数据库迁移，也不启用 Provider。完整步骤见
[v1.6.1 发布说明](/releases/v1-6-1)。发行是否完成以实际 Release 与包资产为准；
网站保留原域名，以 `/release.json` 标识部署版本和源码提交。

## 人类文档与 Agent 合同

| 你是谁 | 从哪里开始 | 权威边界 |
| --- | --- | --- |
| 采用者、运维或产品维护者 | 本站的采用状态、Admin、架构与发布页面 | `docs/docs/**` 是公开的人类说明 |
| Foundation 贡献者 | [参与贡献](/coding/first-contribution) | 最近的 `AGENTS.md` 约束工作方式，`.mss/**` 保存机器事实 |
| Foundation AI Agent | 仓库根与目标目录的 `AGENTS.md` | `AGENTS.md` → `.mss/**` → 对应 `.agents/skills/**` |
| Thin Host AI Agent | 生成应用仓库的本地入口 | 生成仓库自己的 `AGENTS.md`、`.mss/**` 与 Skills；不继承 Foundation 发布技能 |

[Agent 协作](/agent)面向阅读文档的人，负责解释上述边界和导航；它不是 Agent 的
隐藏提示词或可执行合同副本。机器事实变更必须先修改其权威源，再同步人类说明。

配置、开发和 Agent 页面描述产品与仓库合同。Docs 网站部署是独立的展示面，仓库内
机器事实、组件发布台账和当前稳定策略仍是采用判断的权威来源。
