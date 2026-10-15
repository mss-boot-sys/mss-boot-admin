---
title: 原生 OIDC Provider 与 Proxmox VE
---

# 原生 OIDC Provider 与 Proxmox VE

本文对应 `mss-boot-sys/mss-boot-admin` v1.6.1 发行范围内的 OIDC Provider。协议实现与真实集成验收分别记录，不能以版本号代替部署验收。[英文版](./oidc-provider.md) 包含完整协议表与测试边界。

平台继续管理账号、身份和策略，不引入独立身份服务。核心认证复用密码校验、浏览器 cookie、数据库会话、账号禁用和审计。`admin/oidc` 使用已有的 JWT 库及 Go 密码学实现，独立签发 OIDC 凭证，不向 PVE 交付 Admin 自身 JWT。

## 启用与迁移

先按正常流程迁移 Admin 数据库，再启动服务。从 `admin/` 运行 `go run . migrate --help` 查看迁移参数；使用已配置的环境执行 `go run . migrate`。本次增加迁移 `20261010100000`：七张独立 OIDC 表和默认拒绝的菜单/API 权限，不改写已有用户、会话和业务数据。已有自定义 `/sso` 菜单发生冲突时，迁移会停止，需人工明确解决归属。

选择浏览器和所有 PVE 节点均可访问的稳定公网 HTTPS origin，在同一 origin 下提供前端与 API。以下是示例，不会自动创建 DNS 或部署服务：

```yaml
application:
  origin: https://identity.example.com
auth:
  browserSession:
    secure: true
    sameSite: lax
oidc:
  enabled: true
  issuer: https://identity.example.com/admin/api/oidc
  keyEncryptionKeyEnv: MSS_OIDC_KEY_ENCRYPTION_KEY
```

在安全的运维会话中用 `openssl rand -base64 32` 生成独立的 32 字节随机包装密钥，通过密钥管理器或环境变量注入 `MSS_OIDC_KEY_ENCRYPTION_KEY`。不要提交到 Git、放入命令参数或截图、输出到日志。所有副本必须使用同一值和数据库，并将该密钥与数据库分别备份。

Provider 默认关闭。开启后，issuer、cookie 策略、签名表或包装密钥无效会阻止启动，不会临时生成不持久的替代身份。Discovery 地址是 issuer 后加 `/.well-known/openid-configuration`。一期要求固定 `/admin/api/oidc` 和标准 `/admin` 路由组。

授权地址位于现有 `/admin/api` cookie 路径下，所以跨站顶层 GET 跳转可以携带 Secure、HttpOnly、SameSite Lax 会话。不会把 cookie 路径扩展到 `/`，也不会放宽全局 CORS 或跳过后台 CSRF。授权继续流程额外绑定短期 HttpOnly 浏览器 cookie；同意授权的 POST 使用现有 CSRF 机制。Token/UserInfo 使用各自的客户端或 bearer 凭证。

## Provider 未启用时的控制台状态

在 v1.6.1 中，SSO 菜单仍按原有菜单权限保留。`oidc.enabled` 为 false 时，已登录且具备原有客户端列表 API 权限的管理员访问 `GET /admin/api/sso/clients`，会收到 HTTP 503 和 `errorCode: SSO_PROVIDER_DISABLED`。控制台显示“SSO 尚未配置”，提示联系管理员完成配置。这一确定的禁用状态不显示重试操作，也不自动重试。本补丁不新增迁移、不启用 Provider；已启用时的行为保持不变。该响应不包含配置或密钥，协议路由和管理写入路由仍不注册。

未登录请求仍返回 401，无 API 权限返回 403。网络故障、普通 404（包括旧版后端）及其他服务错误仍显示可重试的加载失败。应配套部署前后端修复，控制台不会根据路由不存在推断 Provider 未启用。

## 注册应用与授权

在系统菜单打开 **SSO 应用**，以 root 初始化管理授权，再按需委派：

| 权限 | 用途 |
| --- | --- |
| `sso:read` | 读取应用与签名密钥元数据 |
| `sso:write` | 注册、编辑、禁用应用及允许访问名单 |
| `sso:secret-rotate` | 轮换客户端密钥 |
| `sso:key-rotate` | 轮换 Provider 签名密钥 |
| `sso:audit` | 查看授权与管理审计 |

应用登录资格和后台管理权限分别校验。仅需登录 PVE 的用户不需要任何 SSO 管理权限，更不需要 root。Admin root 也必须显式列入应用的用户或角色允许名单。

建议每个 PVE 集群或独立实例注册一个 client；同集群多个浏览器 origin 可共用。不能仅根据主机名称推断集群关系。

1. 登记每个精确 HTTPS 回调 origin，例如 `https://pve.example.com:8006`。PVE 使用 `location.origin`，不要添加 `/callback`、末尾斜线，或省略实际端口。多个代理/节点 origin 分别登记；不允许通配符、fragment 或 HTTP。
2. 按 PVE 常用请求允许 `openid`、`profile`、`email`。可选返回 `name`、`preferred_username`、`email`；实际返回还受请求 scope 限制。`sub` 始终返回。现有用户资料不能证明邮箱已验证，因此不声称 `email_verified=true`。
3. 填写允许的用户 ID 或角色 ID。两类名单取并集，均为空则拒绝所有人。这里的角色是受管理的授权组；不会使用用户可编辑的个人资料 `group` 字段。暂不发布 groups claim，也不自动映射 PVE 组。
4. 安全保存 client ID 和仅展示一次的 secret。256 位随机 secret 在数据库中只保留 SHA-256 摘要，列表不返回 secret 或摘要。关闭弹窗即清除组件内的明文，丢失后只能轮换。

编辑应用或轮换 secret 会递增配置版本，已有授权请求、授权码和 UserInfo access token 随即失效。并发旧版本写入返回 409，需重新加载。禁用 client 会拒绝后续授权、兑换和 UserInfo 请求。

## 配置 PVE realm 与 ACL

在另行授权的测试集群中进入 **Datacenter → Permissions → Realms → Add → OpenID Connect**。具体标签和可用选项以安装版本为准：

| PVE 配置项 | 值 |
| --- | --- |
| Issuer URL | `https://identity.example.com/admin/api/oidc` |
| Client ID | 应用注册生成的 ID |
| Client Key | 仅展示一次的 secret |
| Scopes | `openid email profile` |
| Username claim | 推荐 `sub` |
| Autocreate | 运维策略决定；创建账号不等于授予 ACL |

`sub` 是持久随机身份，与可改名、可复用的用户名或邮箱无关；改名或签名密钥轮换不会改变它，重新创建账号则分配新身份。`preferred_username` 可供展示和兼容，但不推荐作为安全身份。旧 PVE 的 `username` 别名可能映射到它；已有 realm 改换用户名 claim 会改变 PVE 身份映射，需单独规划。

SSO 成功后，由 PVE 管理自己的用户、角色和 ACL。给 `subject@realm` 主体单独分配最小资源路径和权限。`autocreate` 不自动授予虚拟机、存储或集群权限。

当前官方实现使用 Authorization Code、S256 PKCE、state/nonce，并在有 Client Key 时使用 `client_secret_basic`。本实现不支持 `client_secret_post`。参考 [Proxmox OIDC 库](https://github.com/proxmox/proxmox-rs/blob/master/proxmox-openid/src/lib.rs)、[OpenID API](https://github.com/proxmox/pve-access-control/blob/master/src/PVE/API2/OpenId.pm)、[PVE 权限文档](https://github.com/proxmox/pve-docs/blob/master/pveum.adoc)。上游主线资料不能代替对实际 PVE 8.3.0 和 9.0.3 的联调。

PVE 待处理登录 state 位于发起节点本地。反向代理或负载均衡必须保证回调回到对应节点，并在整个流程保持同一外部 origin。同集群共用 realm/client 配置不代表登录 state 共享。

## 协议、会话和运维限制

- Discovery、Authorization、Token、JWKS、UserInfo 使用标准协议响应。支持授权码模式、query 响应模式、S256；支持 Authorization GET 和表单 POST。
- 授权码有效期 60 秒，仅存摘要并原子单次消费，绑定 client 版本、精确回调、用户/会话、scope、nonce 和 PKCE。重放拒绝；同一客户端已消费授权码的重放会撤销该次授权产生的 access token。
- ID Token 与不透明 access token 有效期 5 分钟，无 refresh token、offline access、动态注册、隐式授权或全局注销端点。
- `prompt=none` 不交互，必要时返回 `login_required`；`prompt=login`、`select_account` 和 `max_age` 按条件进入现有登录页重新认证。继续流程不能移除原始条件。`prompt=consent` 显式允许或拒绝；正常流程使用管理员预批准的应用访问与 claim 策略，不重复询问。
- `auth_time` 来源于实际数据库会话登录时间。nonce 从请求绑定到授权码并放入签名 ID Token，PVE 必须比较其预期 nonce。客户端不能通过 token 请求覆盖 nonce。
- 普通 `acr_values` 作为可选偏好接受，包括未知值和空格分隔的多个值；当前忽略这些偏好，不触发 MFA 或认证等级选择。ID Token 不返回 `acr`、`amr`，也不会把请求值当作已验证事实写入令牌。
- request/request_uri、动态注册参数、claims 参数（包括 essential ACR 要求）和 id_token_hint 仍未实现，明确拒绝，不发布虚假支持元数据。`select_account` 通过重新登录选择账号，不维护另一套多账号选择器。本实现不是 OpenID 认证声明。

依据 [Core 15.1](https://openid.net/specs/openid-connect-core-1_0.html#OP_mandatory) 和 [5.5.1.1](https://openid.net/specs/openid-connect-core-1_0.html#acrSemantics)，普通 `acr_values` 偏好本身不会导致有效登录失败。例如 `acr_values=urn:example:mfa%20urn:mss:password` 可继续授权码流程，但 ID Token 不声称满足任一等级，也不保证 MFA。通过 `claims` 请求 `acr.essential=true` 仍返回 `invalid_request`，不会静默宣称满足强制认证强度。参数长度和唯一性、会话、应用授权、prompt/max_age、精确回调、nonce、PKCE 校验继续生效。此兼容修复纳入 v1.5.0，但不代表已完成真实 PVE 验收。

UserInfo 每次重新核验账号与角色有效性、未撤销会话、client 版本和应用授权。禁用账号/client、撤销平台会话或移除应用访问可阻止 Provider 后续请求，但已签发 ID Token 在到期前仍可通过密码学验证。PVE 自己签发和续期 ticket/CSRF，**平台退出或禁用不会天然立即终止所有已有 PVE 会话**。紧急处置需使用 PVE 自身的会话和访问控制。

签名密钥使用独立包装密钥做 AES-256-GCM 加密，首次开启时事务创建，重启复用。轮换后旧公钥保留 24 小时，覆盖 5 分钟令牌和 JWKS 刷新；旧加密密钥记录保留用于审计/备份。丢失或直接更改包装密钥会阻止签名，本期不提供包装密钥自动迁移。subject 表、签名密钥、issuer 状态与包装密钥必须保持备份一致性。安全查询强制读取主库，不能依赖有延迟的只读副本。回退时关闭 `oidc.enabled`，保留数据表。

| 现象 | 排查 |
| --- | --- |
| Discovery/管理页 404 | Provider 是否启用、是否使用标准路由组 |
| 启动失败 | HTTPS issuer、同源前端、包装密钥、持久化 issuer 是否一致 |
| 无重定向或 `invalid_request` | client 与精确回调、重复参数、未支持的请求参数 |
| `invalid_client` | client 启用状态、新 secret、HTTP Basic 认证 |
| `invalid_grant` | 60 秒到期、重放、client 版本、redirect、verifier、账号/会话状态 |
| `access_denied` | 用户/角色允许名单，账号与角色启用状态 |
| 循环登录 | cookie 的 host/path/Secure/Lax、公共 origin、prompt/max_age、会话过期 |
| PVE 登录后无资源权限 | PVE ACL 和 `sub@realm` 身份映射 |
| PVE 找不到 state | 代理将回调分配到其他节点或改变 origin |

授权审计记录行为、client/user ID、时间与结果，不记录 code、verifier、secret、token、nonce、state 或请求体。应用日志脱敏无法覆盖上游 CDN/反向代理，需在那里配置同等的请求参数和请求头脱敏。协议依据为 [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html) 与 [Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)。

## 验收与下一步

自动化测试覆盖真实平台密码登录与 cookie、SQLite 持久化、协议 HTTP、独立 JWKS 验签、会话复用、prompt/max_age/consent、授权码重放/并发、PKCE/client/回调绑定、账号与会话撤销、轮换、权限和迁移。管理页面浏览器测试使用明确标注的管理 API 夹具；不代表真实 PVE 验证。

部署前须在明确授权的 PVE 8.3 和 9.0 测试实例记录实际包版本，并验证首次和第二个 client 登录、精确回调、节点粘性、nonce、签名轮换、禁用账号/client、PVE ACL 拒绝及 PVE 自身注销。本开发任务不修改现网 realm、ACL、宿主机、DNS，也不发布版本。
