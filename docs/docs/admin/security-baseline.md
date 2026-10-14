---
title: 安全基线
order: 7
description: v1.4.0 发行版 Admin 身份、授权、密钥、浏览器与供应链最低要求
---

# v1.4.0 发行版安全基线

:::warning
版本范围：**v1.4.0 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.3.9 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
Docs 网站可通过 `docs/v*` 异步候补，不影响组件、稳定别名或采用。
:::

## 身份与会话

- 密码只保存带盐单向 verifier，不支持显示或恢复；
- 改密、解绑 OAuth 等敏感操作要求近期重新认证；
- 浏览器使用 HttpOnly 会话和 CSRF 防护；
- WebSocket 使用一次性短期 ticket，不在 URL 放长期凭据；
- 生产使用 HTTPS、Secure Cookie 和精确 origin。

### 后台登录白名单（`auth.adminLogin`，main 分支，尚未发布）

外部身份（GitHub、飞书）登录后台可以用白名单限制：

```yaml
auth:
  adminLogin:
    allowlist:
      - provider: github
        id: "583231"     # GitHub 数字用户 ID，推荐，改名不受影响
      - provider: github
        login: octocat   # GitHub 登录名，不区分大小写
    secondFactor: off    # 本版只接受 off；TOTP 另行提供
```

- 名单为空（默认）时行为与 v1.4.0 完全一致；
- 名单非空时，名单外的外部身份在建号和签发令牌之前被拒绝，OAuth 回调返回 403，不建用户、不写会话 Cookie，与 `security:registerEnabled` 无关；已绑定但不在名单内的账号同样被拒绝；
- 本地用户名密码与邮箱验证码登录不受白名单约束，Root 账号始终可以用本地凭据恢复访问；
- 拒绝写入登录审计，只记录 provider、登录名和数字 ID，不记录 provider token 或授权码；
- 配置非法（未知 provider、条目缺少 id 和 login、GitHub id 非数字、`secondFactor` 不是 off）时启动失败。

## 授权

- 每个受保护 API 在后端执行 Casbin 或业务授权；
- 行级范围在查询和写入层同时约束；
- UI 隐藏、菜单过滤和路由守卫不是授权；
- 新权限必须有允许与拒绝测试；
- 状态变更不使用 GET。

## 密钥与配置

- 不提交 token、密码、私钥、生产 DSN、kubeconfig 或云凭据；
- 使用环境或部署平台 secret reference；
- 日志、审计、验证报告和浏览器输出脱敏；
- API key 只显示一次，服务端保存哈希；
- 可选集成失败不终止无关能力。

## 浏览器与前端

- CORS 对凭据请求使用精确来源；
- 不把服务端权限或长期令牌放入 localStorage；
- 外链、上传、富文本和动态内容按上下文转义；
- 依赖、锁文件、公开导出和生产 bundle 均纳入验证。

## 供应链与发布

- v1.4.0 的 Root 工具、Go Module、GitHub Packages 包和镜像绑定同一精确 merged-main
  提交；安装固定版本或 digest，并核验 checksum、tarball integrity 与来源；
- 发布前本地完整验证；标签流水线构建和发布产物，不以单一绿色检查冒充全部验证；
- GitHub Packages 下载使用只读认证，发布工作流只授予必要的 `contents` 与 `packages`
  写权限，不把秘密写入源码、镜像层、日志或归档；
- 旧组织历史身份和新仓库正式标签均不可重写或混用；
- Docs 部署核对公开 `/release.json` 与内置浏览器页面，核心制品不因网站修复而重发。

## 上线门禁

Foundation 贡献者按 `.mss/commands.yaml` 运行源码诊断与验证；一般 `doctor`、`verify`
合同可以保留，但这些结果不能替代 v1.4.0 公共制品证据，也不能证明已停止列车可用。

同时完成迁移、权限正反例、真实业务流程、浏览器控制台和回滚演练。任何绕过项必须明确
记录为阻断或剩余风险。
