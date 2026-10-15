# mss-boot documentation

This source tree documents **v1.6.1**, the current coordinated release under
`mss-boot-sys/mss-boot-admin` (v1.3.9 was the first). Versions **v1.3.8** and earlier were published under
`mss-boot-io`; their release pages and evidence remain historical records.

The Distribution uses the new Go module paths and `@mss-boot-sys/admin-web` on
GitHub Packages only. Release readiness is established locally on the exact
merged-main commit; tag workflows build and publish artifacts. Docs keeps the
existing `https://docs.mss-boot-io.top` domain and is published through
`docs/v1.6.1`. Source changes alone do not prove deployment: verify the public
`/release.json` and browser-visible pages.

Start at [`docs/getting-started`](./docs/getting-started/index.md) for the human
quick start; Agent maintainers follow the executable contracts below.

## Audience and authority map

| Audience | Published or repository location | Authority |
| --- | --- | --- |
| Adopters, operators, and contributors | `docs/docs/`, root README files, and `CONTRIBUTING.md` | Human-facing guidance; the Dumi site publishes `docs/docs/` |
| Architecture maintainers | `docs/adr/` | Durable decisions and their status; repository-only, not an adopter tutorial |
| Foundation AI Agents | nearest `AGENTS.md` -> `.mss/` -> applicable `.agents/skills/` | Executable repository contract |
| Generated Thin Host AI Agents | generated `AGENTS.md`, `.mss/`, and local `.agents/skills/` | Executable downstream contract; separate from Foundation maintenance |

`docs/docs/agent/` is deliberately part of the first row: it is a human-readable
guide to Agent collaboration, not an executable instruction source. It links to
the authoritative local contracts instead of copying their release and command
logic.

Within the public site:

- `docs/getting-started/`: adoption status, package and tool availability, and mss-shop;
- `docs/guide/`: day-to-day operation and troubleshooting;
- `docs/admin/`: current Admin configuration, security, and operations;
- `docs/agent/`: human-readable Agent collaboration and contract navigation;
- `docs/architecture/`: current architecture summaries;
- `docs/releases/`: the v1.6.1 release guide, old-organization release records, and a clearly separated read-only archive.

Prompt dumps, one-off plans, test snapshots, and duplicate tutorials are not
documentation inputs.

## Documentation contributor workflow

This section is explicitly for contributors working in a Foundation source
checkout:

```sh
corepack pnpm@9.15.9 --dir docs install --frozen-lockfile
python3 tools/docs/check_current_docs.py
corepack pnpm@9.15.9 --dir docs build
```

The drift check verifies the v1.6.1 repository, version and registry boundaries, operational onboarding contracts, the human/Agent audience split,
navigation targets, internal links, archive banners, and ADR status markers.
