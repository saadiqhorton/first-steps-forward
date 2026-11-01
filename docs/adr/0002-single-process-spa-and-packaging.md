# 0002: Run ADE as one Node process and distribute a small CLI package

**Status:** accepted, 2026-11-01.

## Context

ADE had a Vite dev server, a separately started local API, and a server-rendered app shell. The
development manifest also includes the full Lovable and React toolchain, although a person
running ADE needs only the local Node service and its built browser client. Importing the local
service could initialize the user's workspace, which made build-time imports unsafe. Finally,
`node-pty` has no Linux prebuild and can require a C++ toolchain during installation.

## Decisions

### One Node HTTP server

The production CLI starts one `node:http` process. It serves the built app, local API, and
agent-browser WebSocket on the same listener. The development Vite plugin mounts the same API
handler. Shared startup code applies the loopback default and requires `ADE_TOKEN` when binding
to a non-loopback address.

### No import-time startup and an SPA client

Importing local service modules does not initialize or rewrite `~/.ade`; explicit `start()` owns
that lifecycle. The app is built as an SPA because ADE serves the local client and API together
and does not need request-time server rendering. This keeps build and import behavior separate
from starting the user's local service.

### A staged npm package

The repository manifest remains the Lovable development manifest. `npm run package` builds the
client, stages only the runtime server, CLI, static assets, licenses, and runtime dependencies in
`.pack/`, then creates a tarball. The staged package is invoked with `npx @saadiqhorton/ade` and
requires Node 22+ and Git. It is built and smoke-tested locally; publication remains a separate
release decision.

### Optional prebuilt terminal module

The staged package uses `@lydell/node-pty` under the `node-pty` import name because it offers
prebuilt binaries for common Linux, macOS, and Windows architectures. The terminal remains
optional: if its native module cannot load, ADE reports that terminal access is unavailable and
keeps the other features working. Evidence: the terminal tests pass against it, and in a packaged
install (`npm i -g --prefix <tmp>` of the tarball, 18 MB with no build step) a terminal session
opened over `/api/terminal` ran a command and returned its output.

## Consequences

- A production install starts one process and opens one local port for the UI and local tools.
- Build-time imports do not touch the user's workspace; startup owns ADE's local state lifecycle.
- Users can run the package without installing the repository's large development dependency
  tree.
- Native terminal availability depends on a prebuilt binary for the user's platform. The
  terminal can be absent without preventing the rest of ADE from running.
- The package is not published as part of this decision; versions, release checks, and publication
  remain explicit maintainer actions.
