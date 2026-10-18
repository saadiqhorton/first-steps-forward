# ADE — local agent workspace

ADE is an open-source workspace for local coding-agent CLIs. It does not require an ADE account, hosted backend, or relay. The original Lovable screens were a simulation; the current app replaces its seeded projects, generated agent runs, fake sign-in, and fabricated diffs with a Node service that reads the local filesystem and starts the installed CLI processes.

## Run locally

Requirements: Node.js 22+, npm, Git, and whichever coding-agent CLIs/providers you plan to use. Docker (Docker Desktop or Docker Engine) is required for the agent computer and optional otherwise.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:3100` (the dev server is pinned there; override with `npm run dev -- --port <n>`). The development server and API bind to `127.0.0.1`, not the LAN. To run the built, self-hosted Node server instead:

```sh
npm run build
npm start
```

That server listens on `127.0.0.1:3000` (override with `PORT=... npm start`). It stays loopback-only unless you explicitly opt in: set `ADE_HOST` to a LAN/Tailscale interface address (or `0.0.0.0`) **and** `ADE_TOKEN` to a non-empty secret (`openssl rand -hex 16`); without a token `scripts/start-local.mjs` refuses to listen on a non-loopback address and exits 1. In exposed mode every `/api` request from a non-loopback client must prove the token — as `Authorization: Bearer <ADE_TOKEN>` for scripts, or via an `HttpOnly` `ade_auth` cookie that the UI's token gate obtains by POSTing the token to `/api/auth` once (wrong tokens get 401). A specific `ADE_HOST` also compares the request's Host header against that address as a DNS-rebinding fence; `ADE_HOST=0.0.0.0` (or `::`) spans every interface and accepts any Host name, with the token remaining the gate. Loopback clients — the agent CLIs and ADE on this machine — are exempt from the token either way. Plain HTTP carries the token in the clear, so prefer a Tailscale address, or keep the default loopback bind and front it with `tailscale serve --bg https / http://127.0.0.1:3000`: requests then arrive from the local proxy and the remote browser gets HTTPS without any token configuration.

Add a folder using the native picker when available, or enter its local path. To drop a project from the workspace, use **Remove** in the project header: it deletes only ADE's metadata (session records, process entries) for that project after an explicit confirmation, and never touches the folder or its files.

ADE stores project/session metadata and CLI logs in `~/.ade/workspace.json` (private file permissions); Pi session files are under `~/.ade/sessions/`. Project files are not copied into ADE, and provider credentials are not written to ADE or project files.

## Agents and authentication

ADE detects the installed executable and asks that CLI to report its current auth state. It invokes agents with argument arrays (no shell interpolation):

- **OpenAI Codex:** `codex exec --json --cd <project> --sandbox workspace-write …`; resume uses Codex's session ID. `codex login --device-auth` is an actual supported device sign-in flow and can be started from ADE. Codex's own CLI manages its credentials.
- **OpenCode:** `opencode run --format json --dir <project> …`; follow-ups resume its session. Provider credentials are managed by OpenCode (`opencode auth login`) in its user-level data directory. OAuth availability depends on provider; ADE does not claim every provider supports a browser flow.
- **Model picker:** each task can optionally run on a specific model. ADE reads the installed CLI's own quota-free, cache-backed listing (`codex debug models`, falling back to `--bundled` offline; `opencode models`; `pi --offline --list-models`) — it never refreshes catalogs over the network and never ships a static stand-in list, so what you see is what that CLI currently exposes for the providers configured in it. The chosen model is passed as `-m`/`--model` (`codex exec`, `codex exec resume`, `opencode run`, `pi --model provider/id`); leaving it unset omits the flag entirely so the agent uses its own configured default. The model is recorded in the session's context manifest and shown in the session header. A model id is only charset-validated (first character alphanumeric, so it can never read as a CLI flag; then letters, digits, `. _ / : [ ] - +`, max 256) and is passed verbatim in the argv array — ADE runs no shell, and model ids are split on the first `/` only by the CLI that receives them. Explicit ids always win: ADE never gates a chosen model against the listing and never invents entitlement checks beyond that; the CLI is the authority and its real rejection is surfaced (see below). You can change a session's model from the session header; the change applies from the next CLI turn (a turn already running keeps its current model), and the picker's "Other model id…"/free-text entry covers accounts whose catalog cannot be enumerated.
- **Model listings are cached** in memory and in a private `~/.ade` file (0600) keyed by agent **and CLI version** (a replaced/upgraded CLI cannot serve a stale list), with a 300-second freshness window; the listing being empty is not an error, it means no provider is configured in that CLI, and the picker falls back to manual entry with that reason.
- **Agent switching:** a session can be re-parented to another installed, authenticated agent via `POST /api/sessions/:id/switch-agent`. The new CLI starts fresh: repository state, the task, and the current diff carry over, but the prior conversation does not, and the session records that disclosure. Model ids belong to one CLI's catalog and are never transplanted across agents: switching drops the selected model (the disclosure message names the dropped id) and the new agent starts on its own configured default. Switching is refused while a CLI turn is running and for completed sessions.
- **Context manifest:** every agent turn records a manifest (project/branch, task, acceptance criteria, constraints, candidate files from `git ls-files`, the agent's tool set, and dirty-tree state) in the session, surfaces it as a collapsible detail in the UI, and passes a rendered version to the CLI prompt.
- **Pi Agent:** `pi -p --mode json …`; turns use a session file outside the project. Pi supports `/login` in its interactive TUI, but does not expose a supported device-login API for this browser UI. Use `pi` then `/login` in a terminal; ADE does not fake a sign-in. The provider whose auth Pi reports ready is passed explicitly.

The CLI versions and authentication methods were checked against the installed CLIs and their current documentation: [Codex authentication](https://developers.openai.com/codex/auth/), [OpenCode CLI](https://opencode.ai/docs/cli/) and [providers](https://opencode.ai/docs/providers/), [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). ADE never asks you to paste a token. Some CLIs store credentials in their own user-level files rather than the OS keychain; ADE leaves that choice to the supported CLI flow.

## Agent computer

Each project's right pane has a **Computer** tab: an isolated Linux desktop (a Docker container) that the **agent itself drives** — screenshots, mouse, keyboard, and a Chromium browser — to run and manually test your project, the way Cursor Cloud Agents or Grok computer use do, but fully on your machine. You watch it live in ADE (a view-only noVNC stream) and can take control with the **Take control** toggle. There is no cloud service; nothing leaves your machine.

**Requirements:** Docker (Docker Desktop on Windows/macOS, or Docker Engine on Linux/WSL). Without Docker the pane says so and agents report the computer as unavailable rather than pretending. The image builds from `docker/agent-computer/` on first use (~1 GB download, then ~6 s rebuilds); ADE rebuilds it automatically when those files change.

**Isolation:** one container per project (`ade-computer-<projectId>`), all capabilities dropped, `no-new-privileges`, 2 CPU / 2 GB RAM / 1 GB shared memory. Ports publish on `127.0.0.1` only: noVNC for your view and a token-gated control API for the agent. The VNC password and control token are random per container, stored as Docker labels (not files), so ADE re-finds its containers after a restart. Stopping a project's computer from the pane (or removing the project) deletes the container; nothing persists between runs.

**Agent tools:** every agent gets the same toolset — `computer_screenshot`, `computer_open_url`, `computer_click`, `computer_double_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_wait`, plus `dev_server_status` / `dev_server_start` / `dev_server_stop` for the project's dev server. Every action returns a fresh screenshot. Wiring per CLI: Codex receives the tools as an MCP server (started by Codex itself, so calls work despite its `workspace-write` sandbox); OpenCode receives them through its config; Pi (which has no MCP client) loads a small extension that registers the same tools. All tools call ADE's loopback API, which in turn drives the container's control API.

**Live browser:** the Computer tab's **Browser** view streams the computer's Chromium live (screencast over a loopback WebSocket). It docks in the right pane or pops into a draggable floating window, with back, forward, reload, URL, open-externally and picture-in-picture controls. Click **Take control** to drive the browser yourself; **Hand back** returns it to the agent. While you control it, agent `browser_*` calls (`browser_status`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot` and the rest) and `computer_*` calls fail with a `human_control` message until you hand back. The Chromium DevTools port is published on `127.0.0.1` only, like the other ports. Computers created before this change must be restarted once to pick up the new image: click **Turn off**, then **Start computer**.

**The dev server stays on the host** (native `node_modules`, fast file watching). `localhost:<port>` URLs opened inside the computer reach the host's dev server through a relay that preserves the `localhost` Host header, so Vite/Next host checks pass. The old Preview tab (iframe + attach-a-port form) and Processes list are gone; the agent starts and stops the dev server itself through its tools, and you watch the result on the computer.

**On Windows**, npm `.cmd` shims need a shell wrapper to be spawned safely; ADE handles this in its process layer (`src/local/spawn.mjs`) without ever interpolating arguments into a shell, and kills the whole process tree on stop so dev-server ports are actually freed.

## Safety and current limitations

- **Uncommitted work is protected, not blocking.** You can start a task on a dirty working tree (with a one-click acknowledgment). ADE records the pre-existing changes as the session's baseline, passes the file list to the agent with explicit instructions to never revert, stash, commit, or overwrite them, and marks those files "yours" in the diff view so you can tell your edits from the agent's. The baseline is refreshed at the start of every turn, so you can keep editing between turns. ADE never auto-stashes, resets, checks out, or restores files. It allows one running task per project.
- Codex is invoked with its `workspace-write` sandbox; ADE never passes Codex's dangerous sandbox-bypass flag. OpenCode is not started with `--auto`. ADE does not itself execute deployments or external/shared-system changes.
- Agent-specific interactive approval/question protocols are **not yet bridged to this UI**. An agent may stop, fail, or report a question in its response; ADE shows the real output and lets you follow up. While a CLI turn is still running, a follow-up can wait until that turn exits or stop the turn and send immediately. ADE does not inject text into a running CLI process. Do not treat the current UI as a per-tool approval gate.
- Provider quota/rate-limit failures are detected from the CLI's own wording and reported as a distinct, recoverable state (with the provider's retry hint when given) — never as success, and never substituted with simulated output. Model- and provider-level failures get their own recoverable states from the same real wording: a rejected model id (`model_not_found`, including the CLI's own "did you mean" suggestions), an unusable provider (`provider_unavailable`), refused sign-in (`auth_expired`, with recovery via that CLI's own sign-in flow), and exceeded context (`context_overflow`). **A listed model is not an entitlement guarantee** — listings are account-scoped and some models are plan-gated; only the CLI at run time decides, and its error is surfaced honestly with nothing changed in the project.
- Changing a model mid-conversation applies from the next turn. Whether a CLI preserves conversation context correctly under a different model is **not verified** per CLI (OpenCode and Codex accept the flag on continuation; semantics may differ); the session view states this rather than pretending the swap is inert.
- Deliberately deferred: per-project default model, a catalog-wide (not just credential-filtered) model browser, and reasoning-effort/variant selection — OpenCode silently drops unmatched `--variant` values, and ADE will not silently drop a user's reasoning choice, so the feature waits for honest end-to-end support.
- Project check scripts execute project code and can have side effects. ADE runs none automatically; “Run project checks” asks for confirmation first and reports the actual command, exit status, and output. Missing scripts are not represented as passes.
- Dev-server control is first-class and agent-driven. `POST /api/projects/:projectId/dev/start` re-scans `package.json` inline (a project scaffolded earlier in the same turn is detected immediately), maps launch flags to the detected framework, and reports `running` only after the port really accepts a connection; `dev/stop` works during `starting` and is idempotent (with PID-reuse guards, so a recycled PID is never killed); `GET .../dev` returns bounded status (`{found, status, port, command}`, output tail only). Frameworks that reject `--host` (Next) get only `-H 127.0.0.1`; unknown scripts get `PORT` plus `HOST=127.0.0.1` in the environment — the probe cannot verify a wide bind for those, so they are always pinned to loopback. Projects with no dev script get a 404 with instructions (add a proper `dev` script or tell the user — never fall back to a detached process); double starts get 409 with the current record. Agents drive the same endpoints through their `dev_server_status`, `dev_server_start`, and `dev_server_stop` tools (see **Agent computer**), which call ADE's loopback API from outside the CLI sandbox — the reliable path where a sandboxed shell curl may be blocked.
- Claude Code is deferred. There is no ADE cloud service or telemetry. The original type direction is preserved with locally bundled OFL-licensed fonts (licenses are in `public/licenses/`); the UI makes no third-party font requests.

## Architecture

The existing TanStack Start/React app and warm workbench visual direction are retained. A small Node local-service module is mounted into Vite dev/preview and the self-hosted Node server. Agent adapters are isolated in `src/local/adapters/` so additional CLIs can be added without changing UI state. The service owns project registration, Git inspection/diffs, task persistence, child-process lifecycle, CLI streaming, checks, and development servers. The browser polls that loopback API; browser storage is no longer the source of truth.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
