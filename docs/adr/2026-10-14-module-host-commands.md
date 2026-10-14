# ADR: Module install and maintenance as host-binary subcommands

- Status: Accepted for v1.6.0
- Date: 2026-10-14
- Scope: `admin/business` (Registration.Commands), host Cobra tree

## Context

Optional modules need install, uninstall and migration commands. The `mss`
developer CLI (`cmd/mss`, `internal/mss`) belongs to the root Agent module and
must not import Admin business packages or external modules, so it cannot run
module code.

## Decision

1. `business.Registration.Commands []business.CommandFactory`, where
   `CommandFactory func() *cobra.Command`. The host calls each factory when it
   builds its command tree, so every execution gets fresh Cobra state.
2. Module commands are added to the host binary root next to `server` and
   `migrate` (for example `<host> portal install`).
3. Names must match `^[a-z][a-z0-9-]{0,31}$`, must not be reserved (`server`,
   `migrate`, `help`, `completion`, `version`, `config`, `admin`), must not
   declare aliases, and must be unique across modules. Violations fail
   composition.
4. With no module commands, the host command tree is unchanged.
5. `mss` may later offer a static `mss module list` that reads `.mss/modules`;
   it never executes module commands.

## Consequences

Install, uninstall and purge semantics are owned by each module and are not
part of the core lifecycle.
