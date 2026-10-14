---
title: Foundation 贡献者入门
order: 1
description: 明确隔离的 mss-boot-admin 源码贡献流程
---

# Foundation 贡献者入门

> 版本范围：**v1.5.0 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.4.0 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
> 本页只适用于修改 Foundation 的贡献者；采用者从[快速开始](/getting-started)进入。Docs 网站
> 可异步候补，不阻断组件、稳定别名或采用。

## 获取源码

```sh
git clone https://github.com/mss-boot-sys/mss-boot-admin.git
cd mss-boot-admin
git switch main
```

阅读根和目标目录的 `AGENTS.md`，确认工作树和分支，再创建主题分支。不要覆盖无关
本地改动。

README、CONTRIBUTING 和 `docs/docs/**` 是给人类看的说明；Agent 的执行权威是最近的
`AGENTS.md`、`.mss/**` 与适用 `.agents/skills/**`。不要把公开 `/agent` 页面当作提示词
复制进任务，也不要把 Foundation 维护技能分发给 Thin Host。

## 建立上下文

```sh
go run ./cmd/mss context
go run ./cmd/mss doctor
```

源码模式只用于贡献者。中大型变化先更新 `.mss/features/`，再实现最小一致变更。

## 验证

```sh
go run ./cmd/mss verify --changed
python3 tools/docs/check_current_docs.py
corepack pnpm@9.15.9 --dir docs build
```

按影响补充 Framework 独立测试、Admin 测试、前端 lint/test/build、迁移或浏览器证据。

## 提交

通过 PR 合入 `main`。不要直接推送 `main`、改写已推送历史或从未合并提交发布。交付
说明列出实际命令、结果、未执行项、兼容与安全影响。

PR 检查按变更范围执行，详细规则见 [PR 流水线与安全基线](./pull-request-checks.md)。
