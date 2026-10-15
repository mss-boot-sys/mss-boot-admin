---
title: Agent 协作
order: 1
nav:
  title: Agent 协作
  order: 4
description: 给人类维护者看的 Agent 协作入口，以及 Foundation 与 Thin Host 权威合同边界
---

# Agent 协作

:::info
本区是**给人类看的公开说明**，用于理解、审查和导航 Agent 工作流；它不是 Agent 的
可执行提示词或第二套权威合同。Foundation Agent 必须从源码仓库最近的 `AGENTS.md`
进入，Thin Host Agent 必须从生成仓库自己的本地合同进入。
:::

v1.6.1 是当前发行基线（v1.3.9 为新仓库首发）；组件、包、镜像与工具统一使用新组织身份。Thin Host 安装、创建与升级从[快速开始](/getting-started)进入；本区只解释
人类如何审查 Agent 合同。Docs 通过独立标签部署；网站延迟或失败不使已发布的不可变组件制品失效，但协调发行必须在生产 Docs 与 `/release.json` 验证通过后才算完成。

## 两种 Agent 上下文

| 上下文 | 权威读取顺序 | 适用工作 |
| --- | --- | --- |
| Foundation 源码 | 最近的 `AGENTS.md` → `.mss/project.yaml`、`capabilities.yaml`、`commands.yaml` 与目标规格 → 对应 `.agents/skills/*/SKILL.md` | 维护框架、完整 Admin、生成器、发布与文档 |
| 生成 Thin Host | 生成仓库的 `AGENTS.md` → 本地 `.mss/**` → 本地 `.agents/skills/**` | 组合已发布 Admin Distribution 与业务模块 |

Foundation 的发布、文档发布、新应用生成等维护技能不会自动分发给 Thin Host；Thin Host
也不能靠克隆 Foundation、复制源码或隐藏对话上下文补齐缺失能力。

## 权威层次

| 位置 | 作用 |
| --- | --- |
| `AGENTS.md` | 作用域、所有权、安全和验证边界 |
| `.mss/project.yaml` | 工具链、布局、组件和版本 |
| `.mss/capabilities.yaml` | 已实现能力与成熟度 |
| `.mss/commands.yaml` | 可执行命令目录 |
| `.mss/features/`、`.mss/modules/` | 需求、约束、验收与生成规格 |
| `.agents/skills/` | 调用确定性工具的可复用工作流 |

优先级发生冲突时，以编译代码和迁移、机器合同、测试证据、当前架构决策和人类说明的
顺序判断。公开页面只解释这条链路，不复制完整发布脚本或命令选择逻辑。

## 阅读入口

- [仓库内 Agent 起步](/agent/getting-started)
- [规格](/agent/specifications)
- [Blueprint 与升级](/agent/blueprints-and-upgrades)
- [Skills 与 MCP](/agent/skills-and-mcp)
- [验证与评测](/agent/verification-and-evals)
- [Agent-native Foundation 架构](/architecture/agent-native-foundation)

涉及迁移、权限、工作流或新模块时，使用对应 Skill，且后端授权和升级兼容性不能由
前端或生成器替代。
