---
title: Admin 组件状态
order: 1
nav:
  title: Admin
  order: 3
description: v1.6.2 Admin 稳定版、新仓库迁移与采用路径
---

# Admin v1.6.2 稳定状态

:::warning
版本范围：**v1.6.2 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
安装、创建或升级从[快速开始](/getting-started)进入。Docs 通过独立标签部署；网站延迟或失败不使已发布的不可变组件制品失效，但协调发行必须在生产 Docs 与 `/release.json` 验证通过后才算完成。
:::

v1.6.2 以 Thin Host 承载业务组合，不要求业务仓库复制核心启动逻辑。Admin 模块为
`github.com/mss-boot-sys/mss-boot-admin/admin`，完整前端为
`@mss-boot-sys/admin-web`，仅从 GitHub Packages 安装。认证、授权、配置、迁移、
应用壳和页面状态由完整发行统一提供。

本节记录源码行为与使用合同，发布结果以实际 Release 和包为准。

## 参考入口

- [当前能力与边界](/admin/current-capabilities)
- [页面展示配置发布治理](/admin/presentation-configuration)
- [页面展示配置完整设计](/admin/presentation-complete-design)
- [配置指南](/admin/configuration-guide)
- [本地调试](/admin/local-debug)
- [集成验证](/admin/integration-test-guide)
- [容器部署](/admin/docker)
- [安全基线](/admin/security-baseline)
- [操作指南](/admin/operations-guide)
- [权限强化](/admin/permission-hardening)
- [登录故障排查](/admin/login-troubleshooting)

浏览器隐藏按钮不是授权。任何业务扩展都必须由后端执行正向和负向权限测试。
