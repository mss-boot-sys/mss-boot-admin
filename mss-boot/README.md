# mss-boot Framework

[简体中文](./README.Zh-cn.md)

## v1.5.0 release identity

The Framework module is `github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.5.0`.
This is the first release under `mss-boot-sys`; v1.3.8 and earlier belong to
`mss-boot-io`. Update owned Go imports to the new namespace, use Go 1.27.2,
and adapt exported Casbin types to Casbin v3. See the
[release migration guide](../docs/docs/releases/v1-5-0.md).

## Framework boundary

mss-boot provides lifecycle, configuration, logging, cache, queues, locking,
storage, transport, migration, response, condition, retry, idempotency, and
reconciliation primitives. It does **not** contain Admin entities, menus,
business workflows, React code, or Agent orchestration.

The supported dependency direction for v1.5.0 is:

```text
Thin Host business code -> Admin -> mss-boot
```

Most applications should depend on the complete Admin module and let Go
resolve the matching Framework transitively. Direct Framework imports are
reserved for domain-neutral infrastructure extensions. A Thin Host must pin the
complete v1.5.0 distribution rather than assemble a path from v1.3.5 or v1.3.6
components.

Public APIs, configuration keys, interfaces, and persistence behavior are
compatibility surfaces. See the
[package status](../docs/docs/getting-started/packages.md) and
[`CHANGELOG.md`](./CHANGELOG.md).

Repository-source test commands are source-only contributor contracts in
[`AGENTS.md`](./AGENTS.md).
