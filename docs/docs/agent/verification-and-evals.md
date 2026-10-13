---
title: 验证与评测
order: 6
description: change-aware verify、确定性 eval 和证据交付
---

# 验证与评测

## 先看计划

```sh
mss verify --changed --plan --format json
```

计划说明检测到的变更、选择的检查和报告路径，不执行外部命令。

## 执行检查

```sh
mss verify --changed
mss verify --module orders
mss verify --all
```

- `--changed` 是默认日常入口；
- `--module` 聚焦一个垂直模块；
- `--all` 是显式完整审计入口；发布资格只在冻结后的精确 merged-main commit 上使用
  机器合同声明的 release-evidence 模式执行一次。

发布负责人使用的规范入口是：

```sh
mss verify --all --release-evidence --expect-commit <full-sha>
```

该命令名称是长期公开入口；具体检查矩阵仍由 `.mss/commands.yaml`、当前 Feature 与
`mss-release` Skill 管理，本站不复制那份会随实现演进的机器合同。

机器报告位于 `.mss/reports/verify.json`，Markdown 摘要用于审查。退出码和单项结果都
应保留。具体检查选择、工作目录和参数以本地 `.mss/commands.yaml` 与 `mss verify --plan`
为准，公开页面不复制完整发布矩阵。

## 固定完整验证证据

发布台账必须记录完整 commit、报告摘要或哈希和退出结果，并证明验证前后 tracked-clean。
报告单独存在不构成发布授权；它也不替代合并到 `main`、Tag actor、不可变引用、registry 权限与公共制品核验。完整执行顺序由 `mss-release` Skill 与 v1.4.0 Feature 约束，
避免本站成为另一份会漂移的发布手册。

## 手动扩展资格验证

本地证据通过后，如变更涉及 Agent 安装器、跨平台进程管理、前端包交付或浏览器运行
环境，可按 `.mss/commands.yaml` 手动运行对应扩展工作流。记录其完整 Head SHA；不得用
重跑成功掩盖确定性缺陷，也不得以托管工作流替代本地验证或浏览器验收。

## Evals

```sh
mss eval list
mss eval run --all
mss eval report
```

Eval 衡量 Agent 是否遵守规格、边界、生成幂等、迁移、权限和验证合同；它不替代产品
测试或浏览器验收。

## 基础 CRUD 生成测试的可选配置

本节适用于纳入 v1.4.0 的 Foundation 生成器修复。验收范围由
[`generated-service-test-shapes` Feature](../../../.mss/features/generated-service-test-shapes.yaml)
定义。模块没有事件、正则校验、字符串长度校验或搜索字段时，生成器应只输出实际使用的
变量、导入和查询表达式；只有布尔或枚举字段的模块也应能编译并执行后端测试。

采用 v1.4.0 后，已有模块需从规格重新生成并审查差异。

生成的服务测试分别验证分页、搜索和每个筛选条件。分页检查未筛选数据的总数与页面大小；
搜索根据可搜索字段中的实际值判断匹配记录，不能假定两条记录一定只命中一条。例如两条
记录共享可搜索字符串的默认值时，搜索应返回两条；即使布尔筛选能区分这两条记录，也不能
把该筛选带入搜索断言来掩盖错误的预期。每个字段的筛选另行检查返回总数与记录值。

修改生成器后，在 Foundation 源码仓库根目录执行：

```sh
GOWORK=off go test -count=1 ./internal/mss/generator -run '^TestGeneratedServiceOptionalEventsAndPatterns$'
GOWORK=off go test -count=1 ./internal/mss/spec ./internal/mss/generator
```

该配置矩阵在临时消费者模块中执行生成的 Go 测试，并检查连续两次生成没有变化、生成结果
没有漂移；临时本地依赖替换只用于源码贡献者验证。采用包含修复的发行版后，已有模块应先
通过 `mss spec validate` 验证规格，再审查 `mss module generate` 的默认 dry-run，使用
`--write` 更新并重跑 `--check`，不要手改生成文件。
MySQL/PostgreSQL 测试另需配置受限的测试数据库；未配置时的跳过结果不构成提供者验证通过。

## 按影响增加证据

| 变化 | 最低附加证据 |
| --- | --- |
| Go | focused test，再运行受影响模块 |
| Framework | 独立 `GOWORK=off` test/vet |
| 前端 | lint、TypeScript、focused test、相关 build |
| 迁移 | 空库和上一版本升级 |
| 权限 | 后端允许与拒绝 |
| 生成器 | schema、golden、路径限制、两次幂等 |
| UI | Codex 内置浏览器桌面、窄屏、深链、控制台 |

报告未执行检查及具体原因；不要把计划、服务健康或单一页面截图写成完整通过。
