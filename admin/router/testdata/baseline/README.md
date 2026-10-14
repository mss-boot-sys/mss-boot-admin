# Admin API baseline snapshot (v1.5.0 P1)

These golden files freeze the current Admin HTTP surface so later security work
(login allowlist, token `iss`/`aud`, surfaces) cannot add, remove or reclassify
an existing route by accident.

| File | Source | Checked by |
|---|---|---|
| `routes-prod.txt`, `routes-dev.txt` | `InitRouter` route table (`METHOD path`) per application mode | `go test ./router -run TestAdminBaselineSnapshot` |
| `security-route-contract.json` | `CustomRouteContracts()` (class, permission, root-only, mutation) | same test |
| `openapi-operations.txt` | generated `admin/docs/swagger.json`: method, path, security, parameters, response codes (prose ignored) | `tools/verification/check_openapi_baseline.py` (Swagger and CI workflows) |

Intentional changes regenerate the snapshot in the same PR and the diff is reviewed:

```bash
cd admin
MSS_UPDATE_BASELINE=1 go test ./router -run TestAdminBaselineSnapshot
go generate . && python3 ../tools/verification/check_openapi_baseline.py docs/swagger.json --update && rm -rf docs
```
