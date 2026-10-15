---
title: 源码能力与发布边界
order: 2
description: v1.6.1 发行版源码能力、新仓库迁移与采用边界
---

# v1.6.1 发行版源码能力与发布边界

:::warning
版本范围：**v1.6.1 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
安装、创建或升级从[快速开始](/getting-started)进入。Docs 通过独立标签部署；网站延迟或失败不使已发布的不可变组件制品失效，但协调发行必须在生产 Docs 与 `/release.json` 验证通过后才算完成。
:::

机器可执行事实以 [`.mss/project.yaml`](https://github.com/mss-boot-sys/mss-boot-admin/blob/main/.mss/project.yaml)
和 [`.mss/capabilities.yaml`](https://github.com/mss-boot-sys/mss-boot-admin/blob/main/.mss/capabilities.yaml)
为准。v1.6.1 的公共制品按发布流程核验；源码中的版本号不能代替发布结果。

## merged-main 源码能力

| 范围 | 源码合同 |
| --- | --- |
| 后端 | 会话认证、Casbin 授权、配置提供方、迁移、缓存、任务、通知、对象存储、健康检查 |
| Admin Web | React 19、Ant Design 6、Umi Max、React Query、登录壳、路由、页面状态、主题和 locale |
| 业务扩展 | 编译期 Go 模块、确定性菜单与路由、迁移就绪、生成合同 |
| Agent 工作流 | 规格、生成、诊断、开发、验证、评估和三方升级实现 |
| 发行治理 | 组件资格、受保护发布、制品来源与外部使用方验证 |

这些能力供 Foundation 贡献者在源码工作区验证。一般源码 `doctor`、`verify` 和生成
合同可以保留，但不能被描述成部分列车已交付的完整下游工具。

## 明确边界

- Thin Host 不复制 Admin、Framework 或完整前端源码；
- 不提供浏览器运行时建模、虚拟 CRUD 或远程代码加载；
- 不自动把 UI 权限当作后端授权；
- 不要求生产凭据完成源码验证；
- 不在工具设计中加入遥测和采用者登记；
- `mss-shop` 必须以已完成公共对账的 v1.6.1 为基础，并独立证明其单租户范本边界。

后续版本只有在 Root 工具、Go/npm 包、镜像与外部使用方证据全部公开对账后，才能把
源码能力转成新的可执行采用路径；Docs 网站继续在独立链路对账，不加入该采用门禁。
