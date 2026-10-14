---
title: 发布
order: 0
nav:
  title: 发布
  order: 6
description: v1.5.0 当前发行、v1.4.0 UI 刷新、v1.3.9 新仓库首发与旧组织历史记录
---

# 发布

**v1.5.0 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首个发行基线）。 v1.3.8 及更早版本
发布于原 `mss-boot-io` 组织；原组织不可见，本次不恢复旧标签或补发旧产物。

- [v1.5.0 发布与升级说明](/releases/v1-5-0)
- [v1.4.0 UI 刷新与生成器升级](/releases/v1-4-0)
- [v1.3.9 首发与迁移说明](/releases/v1-3-9)
- [v1.5.0 快速开始](/getting-started)
- [GitHub Packages 与 Go 模块](/getting-started/packages)
- [v1.5.0 工具说明](/getting-started/tooling)
- [v1.3.7 历史发布记录](/releases/v1-3-7)
- [v1.3.6 历史发布记录](/releases/v1-3-6)
- [v1.3.5 历史发布记录](/releases/v1-3-5)
- [更早历史归档](/releases/archive)

代码经 PR 合入 `main` 后，在精确提交完成本地完整验证。组件标签触发构建和产物发布，
npm 仅发布 GitHub Packages。Root、Framework、Admin、前端和镜像使用相同版本与源码。
Docs 继续使用 `https://docs.mss-boot-io.top`，由 `docs/v1.5.0` 发布。

发布结果以实际 Release、包、校验和及镜像为准；网站以公开 `/release.json` 的版本、
完整提交和浏览器验证为准。文档源码更新不代表发布或部署已完成。
