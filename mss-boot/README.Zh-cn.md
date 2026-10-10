# mss-boot Framework

[English](./README.md)

## v1.3.9 发行身份

Framework 模块为 `github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.3.9`。
这是 `mss-boot-sys` 下的首个版本；v1.3.8 及更早版本归属原 `mss-boot-io` 组织。
请将业务 Go imports 迁入新命名空间，使用 Go 1.27.2，并将 Casbin 导出类型适配至 v3。
详细步骤见[发布迁移指南](../docs/docs/releases/v1-3-9.md)。

## Framework 边界

mss-boot 提供生命周期、配置、日志、缓存、队列、锁、存储、传输、迁移、响应、条件、
重试、幂等与协调等基础能力；不包含 Admin 实体、菜单、业务流程、React 代码或 Agent
编排。

v1.3.9 的受支持依赖方向是：

```text
Thin Host 业务代码 -> Admin -> mss-boot
```

大多数应用应依赖完整 Admin Module，并让 Go 传递解析匹配的 Framework。只有领域无关
基础设施扩展才直接依赖 Framework。Thin Host 必须锁定完整 v1.3.9 发行版，不能从
v1.3.5 或 v1.3.6 组件拼装安装路径。

公开 API、配置键、接口和持久化行为仍是兼容性表面。参见
[包发布状态](../docs/docs/getting-started/packages.md) 与
[`CHANGELOG.md`](./CHANGELOG.md)。

仓库源码测试命令是 source-only 贡献者合同，保留在 [`AGENTS.md`](./AGENTS.md)。
