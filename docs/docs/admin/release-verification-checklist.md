---
title: Admin 发布与部署验证清单
order: 28
nav:
  order: 1
  title: admin
description: 完整 Thin Host 业务发行前后的最小验证清单
keywords: [admin release checklist smoke regression]
---

## 使用方式

本清单用于 v1.6.1 新仓库首发与业务 Thin Host 部署。发布变更先通过 PR 合入 `main`，
再从精确且 tracked-clean 的提交执行一次本地完整验证。正式标签流水线仅校验来源、构建
并发布对应制品，不重复宽泛质量矩阵，不依赖托管候选预览或稳定晋升轮次。

npm 包只发布 GitHub Packages；Docs 源码与站点必须同时对齐。源码、PR 成功或单一产物
不能单独证明完整发行，所有结论都应附实际验证结果。

## 一、发布前检查

### 构建检查

- [ ] PR Head 执行 `mss verify --changed`、影响计划选中的聚焦检查与受影响页面内置浏览器验收；PR 阶段不重复完整发布资格套件
- [ ] Foundation 根目录在精确 merged-main commit 上执行 `mss verify --all --release-evidence --expect-commit <full-sha>` 成功，报告中的 commit、trackedCleanBefore 和 trackedCleanAfter 均精确
- [ ] 保存真实外部 Thin Host 检查输出的系统临时证据目录路径，并核验其中脱敏的 `evidence-manifest.json`；需要长期留存时记录目录归档哈希
- [ ] 完整验证包含 Agent 构建、Admin/Framework race、coverage、vet 与模块元数据、独立 next-Foundation 生成和升级、CLI/MCP/doctor 身份一致性、确定性冲突、第二次升级零变更、eval、依赖审计、release workflow 合同、delivery smoke 与 Playwright E2E
- [ ] PR、审查记录或仓库外发布台账记录完整 commit、`trackedCleanBefore: true`、`trackedCleanAfter: true`、精确命令、verify report 哈希或摘要及退出结果；本地报告单独存在不授权发布
- [ ] Codex 内置浏览器在同一精确 commit 完成桌面、窄屏、深链、刷新、控制台和失败网络请求验收
- [ ] 轻量 `pr-ci` 文档、路由和工作流治理检查通过；影响范围内的测试与安全检查在本地完成。`main` 和定时任务不自动运行重型矩阵；托管诊断仅按需手动触发
- [ ] 本地核验同一 frozen commit 的六平台二进制、portable delivery、Thin Host、SBOM、校验和和双架构 OCI 构建
- [ ] Admin Tag 流水线在 Framework 已公开后，以 GOWORK=off 和公共 Go Proxy 解析精确 Framework 并通过 app/business 组合测试
- [ ] 后端和 Admin Web 依赖都精确为同一个已完成公共对账的协调版本，锁文件无漂移
- [ ] 面向 Distribution 使用者的源文档如有更新，版本与采用状态不误导；公开 Docs 网站部署状态单独记录，不作为本节通过条件

### 核心能力检查

- [ ] 登录成功且首次登录状态正常
- [ ] Welcome 页监控卡片与趋势图正常
- [ ] 日志页面能看到登录日志、审计日志、运行时日志
- [ ] 仅在显式 Local 开发 Delivery 中执行头像上传 smoke，并确认 `/public/uploads/{uuid}` 内容一致；该结果不作为生产 Provider 证据
- [ ] 当 Local/S3-compatible 仍为 Legacy / Blocked 时，生产 ingress 已阻断两个上传路径，且未授予通用 `storage:upload` 权限作为纵深防御；头像入口没有独立 Casbin permission
- [ ] 告警规则可以保存
- [ ] 已启用任务状态正常
- [ ] 国际化接口可返回有效语言资源

## 二、发布后冒烟检查

- [ ] `/healthz` 正常
- [ ] 前端首页可打开
- [ ] WebSocket 在线状态正常
- [ ] `/public/` 未被当作生产对象 Delivery 代理，两个上传入口仍被部署侧阻断
- [ ] 后端日志无持续性 fatal 错误

## 三、异常归属建议

| 现象 | 优先排查 |
|------|----------|
| 前端空白页 | 前端构建、代理、接口鉴权 |
| 监控图表无数据 | `/admin/api/monitor` 的 `collectedAt`/`stale`/`instanceId`、内置系统作业日志、登录态 |
| 头像入口被禁用 | 当前 Provider / Delivery evidence 状态、ingress 与权限门禁；不要通过临时开放 `/public/` 绕过 |
| 告警不发送 | 通知配置、规则状态、日志输出 |
| 用户任务未执行 | `task.enable`、cron 表达式、任务状态、TaskRun |
| 内置监控/会话清理未执行 | task server 启动日志和系统作业错误；不要以 Task/TaskRun 无记录判定失败 |

## 三-A、Docs 网站发布（本次交付必须完成）

- [ ] 仅在准备发布网站时检查 `docs/v*` 身份；该 Tag 只表示网站发布，不是 Distribution Tag
- [ ] Docs Tag 指向已存在 Root Release commit 或其受审 merged-main 后代；更新时先删同名 Release，再删 Tag，确认均不存在后同名重建，禁止 force-update
- [ ] Docs 源来自受审 merged-main，受保护部署、替换 Release、归档校验和和 `release.json` 身份一致
- [ ] 在内置浏览器刷新首页与嵌套路由，检查可见版本、控制台和失败网络请求
- [ ] 若任一项失败，记录“网站部署待办”并修复 Docs；保留已发布核心制品，网站核验完成后才交付本次完整任务

## 四、回滚前确认

- [ ] 问题是否来自配置而非代码
- [ ] 数据库结构是否发生变化
- [ ] 若开发环境曾显式启用 Local，已有 opaque-key 对象是否已保留；不要回滚到解析后限流或 user/filename key
- [ ] 日志目录是否需要保留
- [ ] 通知渠道凭据是否改动

## 推荐阅读

- [集成测试指南](/admin/integration-test-guide)
- [v1.3.5 不可变部分发布记录](/releases/v1-3-5)
- [v1.3.6 不可变部分发布记录](/releases/v1-3-6)
- [v1.6.1 发行版说明](/releases/v1-6-1)
- [v1.6.1 快速开始](/getting-started)

## 发布源码认证

`tools/release/verify_release_source.py` 通过 `gh api graphql` 验证精确提交来自已合并的 PR。
本地可使用已经完成 `gh auth login` 的账号；无需导出或复制登录令牌。CI 仍可使用
注入的 `GH_TOKEN` / `GITHUB_TOKEN`。认证失败、未合并或提交不匹配都必须停止发布。

## 完整资格验证的执行环境

本机无法运行 Docker 时，发布操作者可从 `main` 手动触发 `release-qualification.yml`，
将 `expected_commit` 设为当前已合并 `main` 的完整 SHA。该流程在一个隔离 runner 中执行
原有完整 `mss verify --all --release-evidence --expect-commit` 命令（包括真实 Docker 和浏览器检查）
及 Docs 构建，前后都验证源码与干净工作树。只读 GitHub 权限仅用于源码证明；没有部署、
包发布或标签写入权限。仅上传脱敏检查结果及原报告 SHA-256，不上传原始日志、环境变量或凭据。
任何失败均阻止资格通过；多个局部 CI 成功不能拼成完整资格。发布前仍需逐项通过验收与治理检查。

### 资格阶段进度与耗时

CLI 在 stderr 输出每项检查的开始、每 30 秒心跳和结束（退出码与耗时）；stdout 的
JSON/Markdown 格式不变。进度只含检查 ID 和计时，不转发子进程输出、参数或环境变量。
成功的脱敏 `qualification.json` 在各检查中保留 `durationNanoseconds`；Docs 构建单独显示
为工作流步骤。心跳不是成功证明，只有全部检查及最终源码复核通过才可发布。

Admin 与 Framework 的资格目标将 race 和 atomic coverage 合为一次全包测试，保留
`-shuffle=on -count=1 -coverpkg=./...`、原覆盖率阈值、vet 和模块元数据检查。
独立 race/coverage Make 目标仍供诊断使用。合并后的仪器开销可能变化，应比较实际
runner 耗时，不把减少测试调用次数等同于固定百分比提速。

2026-10-15 对[成功资格运行 38687464815](https://github.com/mss-boot-sys/mss-boot-admin/actions/runs/38687464815)
（`81d592a0e16ef210331249945baa63cb3dac6de4`）的审计基线：总计 24 分 18 秒，依赖准备
71 秒，完整命令与 Docs 合计 22 分 04 秒，其中 Docs 约 11 秒，Go cache 收尾约 46 秒。
旧证据没有检查级耗时，不能据此宣称某个具体检查占用最多。

本轮不并发共享 checkout 的全部检查：Framework tidy 会写模块文件，外部消费者同时读取
这些文件，多个 Node 构建、浏览器开发服务器与 Go race 编译也会竞争 runner 内存。
保留 Framework → Admin → frontend → Root → Docs 发布次序和 Admin 对已公开 Framework
的独立 `GOWORK=off` 门禁。Root 已复用公开 frontend 制品并并行六平台构建；不加入跨
commit、跨运行的资格结果缓存。Demo 已有独立工作流、状态与按版本手动重试入口，
其失败不需要重新创建不可变的核心发布标签。
