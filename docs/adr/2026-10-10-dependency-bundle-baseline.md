# Dependency refresh bundle baseline

- Status: Accepted
- Date: 2026-10-10
- Scope: Admin Web and its generated Thin Host package

## Context

The dependency refresh adopts React 19.3.0, Ant Design 6.6.5,
ProComponents 3.1.15-7, React Query 5.104.1 and Umi Max 4.7.23. Application
routes and business behavior are unchanged. The reference and external-host
release builds compile, but exceed the preceding 905 KiB corpus budget.

The installed dependency and production module checks pass: React, Ant Design
and Query retain their governed singleton versions; retired runtimes, Moment,
core-js and accepted vulnerable build-only dependencies are absent from the
production graph. Module and chunk inspection identifies growth in the updated
ProComponents, React DOM and component dependencies. No additional application
route or separately versioned UI runtime was introduced to produce that growth.

## Measurements

All sizes below use gzip level 6, matching the existing bundle checker.

| Production build | Entry | Largest chunk | Complete JavaScript corpus |
| --- | ---: | ---: | ---: |
| Reference Admin | 4.84 KiB | 220.40 KiB | 926.21 KiB |
| External Thin Host with business contributions | 5.23 KiB | 220.49 KiB | 932.18 KiB |

The reference build was also served over loopback with gzip level 6 and immutable
hashed-asset caching, connected to a real isolated SQLite Admin backend. Each
route used a fresh Chromium 156 context and normal browser cache behavior.
Authenticated contexts logged in through the real session endpoint before
navigation. The expected page content was visible before recording same-origin
Resource Timing entries. Counts include transferred JavaScript encoded bodies,
including preloads, and exclude response headers and browser cache hits.

| Cold route | JavaScript transferred |
| --- | ---: |
| `/user/login` | 810.74 KiB |
| `/workplace` | 810.42 KiB |
| `/suppliers` | 815.74 KiB |

These are compressed transfer measurements, not latency or deployed Nginx
qualification. They demonstrate why the hashed entry size alone is not a page
transfer estimate. Other lazy routes remain in the corpus without being loaded
by every measured page.

## Decision

Set the complete JavaScript corpus budget to **940 KiB**, leaving 7.82 KiB above
the measured external host. Keep the **32 KiB entry** and **240 KiB individual
chunk** budgets unchanged. This updates the current qualification baseline from
905 KiB; it does not alter historical release evidence or introduce an
environment-only bypass.

Keep runtime graph inspection, package installation, lint, type checking, unit
tests, production builds, browser tests and delivery smoke checks mandatory.
Future dependency updates must remeasure the reference application and a real
external host. Another budget increase requires route-transfer evidence and an
ADR update under the original frontend architecture decision.
