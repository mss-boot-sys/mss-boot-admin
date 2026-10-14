# Importable Admin application

## v1.5.0 release identity

`github.com/mss-boot-sys/mss-boot-admin/admin@v1.5.0` is the Admin module for the
first release from `mss-boot-sys/mss-boot-admin`. Pin the matching Framework,
Admin Web and Root tools. Versions v1.3.8 and earlier remain releases of the
former `mss-boot-io` organization; this namespace change requires updating
business imports and rebuilding integrations. See the [release guide](../docs/docs/releases/v1-5-0.md)
for Go 1.27.2, Casbin v3 and OIDC migration notes.

## Composition contract

`admin/app` is the complete backend composition entrypoint. It owns
authentication, authorization, configuration, migrations, HTTP delivery, and
the protected compile-time business extension boundary.

Owned business modules register explicitly:

```go
package main

import (
    "context"
    "log"

    "github.com/mss-boot-sys/mss-boot-admin/admin/app"
    "github.com/acme/orders-admin/internal/modules/orders"
)

func main() {
    if err := app.ExecuteContext(
        context.Background(),
        app.WithBusinessModules(orders.Module()),
    ); err != nil {
        log.Fatal(err)
    }
}
```

Do not copy Admin startup, security middleware, migrations, or core routes into
a business repository. A business module may extend the protected group only
through `admin/business`; UI visibility never replaces backend authorization.

The v1.5.0 tool generates this composition as part of a version-bound Thin Host.
Use the public Root tool and package onboarding guide instead of copying this
repository's Admin source into a business application.

The v1.5.0 bootstrap contract reads the initial administrator password
through hidden input or a one-use `MSS_ADMIN_INITIAL_PASSWORD` secret, stores
only a one-way verifier, and exposes no default password. The generated local
application identity is user `admin` at `http://127.0.0.1:8001`.

See the [component status](../docs/docs/getting-started/packages.md) and
[Admin architecture](../docs/docs/architecture/complete-admin-distribution-and-thin-business-host.zh-CN.md).
Foundation source validation remains contributor-only in
[`AGENTS.md`](./AGENTS.md).
