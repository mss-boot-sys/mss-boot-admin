---
title: v1.6.0 包与导入边界
order: 2
description: v1.6.0 发行版 Go Module、Admin Web npm 包与公共解析方法
keywords: [v1.6.0 stable go module npm admin web package]
---

# v1.6.0 包与导入边界

v1.6.0 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线（v1.4.0 为首发）。下游应用使用同一版本的
Admin、Framework 与 Admin Web，并保留生成器写入的精确锁。v1.3.8 及更早版本属于
原 `mss-boot-io` 组织；迁移时必须更新业务 Go imports、npm scope 与 registry 配置。

## 完整 Distribution 的依赖方向

```text
业务后端模块 ──编译期注册──> Admin ──依赖──> mss-boot
业务前端路由 ──显式注册──> Admin Web 完整应用
```

- 普通 Thin Host 直接依赖 Admin，由 Admin 固定 Framework；只有开发通用基础设施时才
  直接导入 `mss-boot`；
- `@mss-boot-sys/admin-web@1.6.0` 是完整前端发行单元，不拆出第二个 SPA；
- 不使用本地 `replace`、源码目录、未验证的本地 tarball 或相邻版本补齐依赖；
- 后端权限始终是最终权威，前端控件隐藏不能授权请求。

## 在仓库外验证 Go 公共解析

Go workspace 可能掩盖模块元数据问题。以下片段在系统临时目录启动隔离作用域，任一 Go
命令失败都会立即返回非零状态，并在片段结束时恢复位置与 `GOWORK`、删除消费者目录。

POSIX shell：

```shell
(
  set -eu
  consumer_dir="$(mktemp -d)"
  cleanup() {
    status=$?
    trap - EXIT INT TERM
    rm -rf -- "$consumer_dir"
    exit "$status"
  }
  trap cleanup EXIT INT TERM
  cd "$consumer_dir"
  export GOWORK=off
  go mod init mss-boot-sys.local/v139-public-consumer
  go get github.com/mss-boot-sys/mss-boot-admin/admin@v1.6.0
  go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.6.0
  go mod verify
)
```

Windows PowerShell：

```powershell
$previousGowork = $env:GOWORK
$consumerDir = Join-Path ([System.IO.Path]::GetTempPath()) ("mss-v139-consumer-" + [guid]::NewGuid().ToString("N"))
$locationPushed = $false
try {
  New-Item -ItemType Directory -Path $consumerDir -ErrorAction Stop | Out-Null
  Push-Location -LiteralPath $consumerDir -ErrorAction Stop
  $locationPushed = $true
  $env:GOWORK = 'off'
  go mod init mss-boot-sys.local/v139-public-consumer
  if ($LASTEXITCODE -ne 0) { throw 'go mod init failed' }
  go get github.com/mss-boot-sys/mss-boot-admin/admin@v1.6.0
  if ($LASTEXITCODE -ne 0) { throw 'Admin module resolution failed' }
  go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.6.0
  if ($LASTEXITCODE -ne 0) { throw 'Framework module resolution failed' }
  go mod verify
  if ($LASTEXITCODE -ne 0) { throw 'go mod verify failed' }
}
finally {
  if ($locationPushed) {
    Pop-Location
  }
  if ($null -eq $previousGowork) {
    Remove-Item Env:GOWORK -ErrorAction SilentlyContinue
  } else {
    $env:GOWORK = $previousGowork
  }
  if (Test-Path -LiteralPath $consumerDir) {
    Remove-Item -LiteralPath $consumerDir -Recurse -Force
  }
}
```

这段验证只证明公共 Go Module 可解析。完整 Thin Host 仍应由 v1.6.0 `mss new app`
生成，并执行 `mss doctor --strict`、`mss setup` 与 `mss verify --all`。

## Admin Web npm 包

官方包为 `@mss-boot-sys/admin-web@1.6.0`，仅发布至
`https://npm.pkg.github.com`，不发布 npmjs。生成的 Thin Host 固定精确版本与锁文件，
不要手工改成范围版本。

[GitHub Packages 官方文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
要求 npm 下载认证，即使包公开也不能假定匿名安装可用。使用具备
包读取权限的 GitHub 凭据（本机可用 classic PAT 的 `read:packages`），通过秘密存储向
进程注入 `NODE_AUTH_TOKEN`。若组织要求 SSO，还需为凭据授权。不得把令牌写入仓库、
提交历史、镜像层或日志。`.npmrc` 只保存以下配置与变量引用：

```ini
@mss-boot-sys:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

在已有前端 `package.json` 所在目录中执行：

```shell
corepack pnpm@10.34.5 add --save-exact @mss-boot-sys/admin-web@1.6.0
```

其他第三方依赖仍从其既有 registry 获取；不要把全部 npm 依赖转到 GitHub Packages。
安装后核对包版本、`gitHead` 和 tarball integrity。容器构建使用 BuildKit secret 或临时
挂载传入认证，禁止用 Dockerfile `ARG`、`ENV` 或 `COPY` 固化令牌。

Admin Web 既是参考前端，也是唯一完整 Admin npm 单元。认证、布局、运行时和公共合同
不会分散到独立版本包。业务页面写入 Thin Host 的 `web/src/business/` 并通过显式路由、
locale 与 permission 投影接入。

## 镜像与版本一致性

Root 后端镜像与前端镜像使用不可变 digest；生产部署应固定 digest，并确认它们都来自
v1.6.0 的同一源提交。Foundation 参考镜像不是携带业务模块的 Thin Host 业务镜像，不能
直接当作业务系统部署。Docs 网站的 `docs/v*` Tag 只发布网站，不改变 Go、npm 或 OCI
身份。
