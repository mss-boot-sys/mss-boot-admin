---
title: 安全基线
order: 7
description: v1.6.1 发行版 Admin 身份、授权、密钥、浏览器与供应链最低要求
---

# v1.6.1 发行版安全基线

:::warning
版本范围：**v1.6.1 是 `mss-boot-sys/mss-boot-admin` 的当前发行基线**（v1.4.0 为首发）；v1.3.8 及更早版本归属旧组织 `mss-boot-io`。
Docs 网站可通过 `docs/v*` 异步候补，不影响组件、稳定别名或采用。
:::

## 身份与会话

- 密码只保存带盐单向 verifier，不支持显示或恢复；
- 改密、解绑 OAuth 等敏感操作要求近期重新认证；
- 浏览器使用 HttpOnly 会话和 CSRF 防护；
- WebSocket 使用一次性短期 ticket，不在 URL 放长期凭据；
- 生产使用 HTTPS、Secure Cookie 和精确 origin。

### 后台登录白名单（`auth.adminLogin`，v1.5.0 起）

外部身份（GitHub、飞书）登录后台可以用白名单限制：

```yaml
auth:
  adminLogin:
    allowlist:
      - provider: github
        id: "583231"     # 必填：GitHub 数字用户 ID，改名不受影响
        login: octocat   # 可选：仅作备注，不参与匹配
    secondFactor: off    # 本版只接受 off；TOTP 另行提供
    rateLimit:           # 可选：按客户端 IP 限制登录尝试，默认关闭
      limit: 10
      window: 1m
    clientIP:            # 可选：限流与登录审计使用的客户端 IP 规则
      trustedProxies: ["10.0.0.0/8"]   # 可信代理 CIDR/IP；为空时继承 application.trustedProxies（默认也为空）
      header: CF-Connecting-IP         # 可选；为空时依次用 X-Forwarded-For、X-Real-IP
```

- GitHub 条目**只按数字用户 ID 匹配**：登录名可以改名、被他人重新注册，因此 `login` 只是备注；只写 `login` 不写 `id` 的条目启动即报错。启动时不联网解析 ID，可用 `https://api.github.com/users/<login>` 自行查询；
- 名单为空（默认）时行为与 v1.4.0 完全一致；
- 名单非空时，名单外的外部身份在建号和签发令牌之前被拒绝，OAuth 回调返回 403，不建用户、不写会话 Cookie，与 `security:registerEnabled` 无关；已绑定但不在名单内的账号同样被拒绝；
- 本地用户名密码与邮箱验证码登录不受白名单约束，Root 账号始终可以用本地凭据恢复访问；
- 拒绝写入登录审计，只记录 provider、登录名和数字 ID，不记录 provider token 或授权码；
- `rateLimit` 作用于密码登录和 OAuth 回调：超出后返回 429 并带 `Retry-After`，同时写登录审计；限流存储不可用时返回 503（失败即关闭）。内置实现是进程内的 `mss-boot/pkg/keyedlimit` 内存实现，多副本部署需要通过 `middleware.SetLoginRateLimiter` 换成共享存储实现，该实现必须通过 `keyedlimit/limittest` 契约测试；
- 登录限流和登录审计用独立的客户端 IP 规则：只有直连对端在可信代理列表内时才读取转发头，X-Forwarded-For 从右往左取第一个非可信地址；默认（未配置任何可信代理）只用 RemoteAddr，伪造的转发头无法换限流桶或篡改审计 IP。该规则不改变 gin 全局 `ClientIP()` 的行为（全局仍由 `application.trustedProxies` 控制）；
- 配置非法（未知 provider、条目缺少 id 和 login、GitHub 条目缺少 id 或 id 非数字、`secondFactor` 不是 off、`rateLimit` 只填了一半或为负数、可信代理不是合法 IP/CIDR、header 名非法）时启动失败。

### 令牌受众（`iss` / `aud=admin`，v1.5.0 起）

- 后台签发的浏览器会话令牌和个人访问令牌（PAT）都写入 `iss`（`auth.issuer`，默认 `mss-boot-admin`）和 `aud=admin`；PAT 无论自定义 PayloadFunc 怎么写都强制 `aud=admin`；
- 后台接口、会话刷新和 OIDC 浏览器会话只接受 `aud` 含 `admin` 的令牌；`aud` 为其他值（如 `portal`、`user`）或 `iss` 不匹配时一律 401，即使用的是同一把签名密钥；比较为常量时间，只返回布尔结果；
- 兼容模式（默认）：升级前签发、没有 `aud` 的旧令牌在过渡期内仍可用，旧会话在下次登录后换成新令牌，旧 PAT 建议轮换；设置 `auth.requireAdminAudience: true` 进入严格模式，拒绝没有 `aud` 的令牌；
- 新增的其他 surface 不应与后台共用签名密钥，可用 `middleware.SharesAdminSigningKey` 做布尔检查（不暴露密钥指纹）。

#### 升级后何时可以开启严格模式（`auth.requireAdminAudience: true`）

开启严格模式前，必须确认已经没有不带 `aud` 的旧令牌在用：

1. **浏览器会话**：会话令牌有效期是 `auth.timeout`（默认 `12h`）。刷新时会沿用旧令牌的声明，所以升级前登录的会话可以一直不带 `aud` 地刷新，最长刷新窗口是 `auth.maxRefresh`（默认 `2160h`，即 90 天）。从升级部署时间算起，等满 `auth.maxRefresh + auth.timeout`，旧会话就会自然失效。想提前开启，可以让用户重新登录：Root 在"安全 → 在线会话"（`/security/online-sessions`，接口 `GET /admin/api/ws/online`）里逐个撤销旧会话，或者轮换 `auth.key`，这样所有人都要重新登录。
2. **个人访问令牌（PAT）**：创建时如果没填有效期，默认约 100 年，等不到它过期，所以升级前签发的 PAT 必须重新签发或撤销：
   - 界面：账号设置 → 访问令牌（`/account/settings?tab=tokens`），对每个令牌点"刷新"拿到新令牌（新令牌带 `aud=admin`），或者点"撤销"；
   - 接口（必须用浏览器会话调用，PAT 不能给自己续期）：`PUT /admin/api/user-auth-token/{id}/refresh` 重新签发，`PUT /admin/api/user-auth-token/{id}/revoke` 撤销，`GET /admin/api/user-auth-tokens` 列出当前用户的令牌；
   - 注意：重新签发出来的 PAT，有效期是 `auth.timeout`；需要长期有效的令牌，请用 `POST /admin/api/user-auth-tokens?validityPeriod=<时长>` 新建一个，再撤销旧的。
3. **确认已经没有旧令牌**：兼容模式下，每接受一次不带 `aud` 的令牌，服务端都会计数，最多每分钟打一条 WARN 日志 `accepted legacy admin token without aud (compatibility mode)`，带上 `kind`（session 或 pat）和累计数 `legacy_sessions_total`、`legacy_pats_total`。日志里不含令牌，也不含用户信息。宿主程序也可以调用 `middleware.LegacyAudienceTokenCounts()` 把计数接到自己的监控上。连续一个刷新窗口都没有出现这条日志，就可以开启严格模式。

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

- v1.6.1 的 Root 工具、Go Module、GitHub Packages 包和镜像绑定同一精确 merged-main
  提交；安装固定版本或 digest，并核验 checksum、tarball integrity 与来源；
- 发布前本地完整验证；标签流水线构建和发布产物，不以单一绿色检查冒充全部验证；
- GitHub Packages 下载使用只读认证，发布工作流只授予必要的 `contents` 与 `packages`
  写权限，不把秘密写入源码、镜像层、日志或归档；
- 旧组织历史身份和新仓库正式标签均不可重写或混用；
- Docs 部署核对公开 `/release.json` 与内置浏览器页面，核心制品不因网站修复而重发。

## 上线门禁

Foundation 贡献者按 `.mss/commands.yaml` 运行源码诊断与验证；一般 `doctor`、`verify`
合同可以保留，但这些结果不能替代 v1.6.1 公共制品证据，也不能证明已停止列车可用。

同时完成迁移、权限正反例、真实业务流程、浏览器控制台和回滚演练。任何绕过项必须明确
记录为阻断或剩余风险。
