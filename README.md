# ADE — local agent workspace

ADE is an open-source workspace for local coding-agent CLIs. It does not require an ADE account, hosted backend, or relay. The original Lovable screens were a simulation; the current app replaces its seeded projects, generated agent runs, fake sign-in, and fabricated diffs with a Node service that reads the local filesystem and starts the installed CLI processes.

## Run locally

Requirements: Node.js 22+, npm, Git, and whichever coding-agent CLIs/providers you plan to use.

```sh
npm install
npm run dev
```

Open the loopback URL Vite prints (for this preset it defaults to `http://127.0.0.1:8080`). The development server and API bind to `127.0.0.1`, not the LAN. To run the built, self-hosted Node server instead:

```sh
npm run build
npm start
```

That server listens on `127.0.0.1:3000` (override with `PORT=... npm start`). Do not change the host to `0.0.0.0` unless you add your own authentication and network security first.

Add a folder using the native picker when available, or enter its local path. To drop a project from the workspace, use **Remove** in the project header: it deletes only ADE's metadata (session records, process entries) for that project after an explicit confirmation, and never touches the folder or its files.

ADE stores project/session metadata and CLI logs in `~/.ade/workspace.json` (private file permissions); Pi session files are under `~/.ade/sessions/`. Project files are not copied into ADE, and provider credentials are not written to ADE or project files.

## Agents and authentication

ADE detects the installed executable and asks that CLI to report its current auth state. It invokes agents with argument arrays (no shell interpolation):

- **OpenAI Codex:** `codex exec --json --cd <project> --sandbox workspace-write …`; resume uses Codex's session ID. `codex login --device-auth` is an actual supported device sign-in flow and can be started from ADE. Codex's own CLI manages its credentials.
- **OpenCode:** `opencode run --format json --dir <project> …`; follow-ups resume its session. Provider credentials are managed by OpenCode (`opencode auth login`) in its user-level data directory. OAuth availability depends on provider; ADE does not claim every provider supports a browser flow.
- **Model picker:** each task can optionally run on a specific model. ADE reads the installed CLI's own quota-free, cache-backed listing (`codex debug models`, falling back to `--bundled` offline; `opencode models`; `pi --offline --list-models`) — it never refreshes catalogs over the network and never ships a static stand-in list, so what you see is what that CLI currently exposes for the providers configured in it. The chosen model is passed as `-m`/`--model` (`codex exec`, `codex exec resume`, `opencode run`, `pi --model provider/id`); leaving it unset omits the flag entirely so the agent uses its own configured default. The model is recorded in the session's context manifest and shown in the session header. A model id is only charset-validated (first character alphanumeric, so it can never read as a CLI flag; then letters, digits, `. _ / : [ ] - +`, max 256) and is passed verbatim in the argv array — ADE runs no shell, and model ids are split on the first `/` only by the CLI that receives them. Explicit ids always win: ADE never gates a chosen model against the listing and never invents entitlement checks beyond that; the CLI is the authority and its real rejection is surfaced (see below). You can change a session's model from the session header; the change applies from the next CLI turn (a turn already running keeps its current model), and the picker's "Other model id…"/free-text entry covers accounts whose catalog cannot be enumerated.
- **Model listings are cached** in memory and in a private `~/.ade` file (0600) keyed by agent **and CLI version** (a replaced/upgraded CLI cannot serve a stale list), with a 300-second freshness window; the listing being empty is not an error, it means no provider is configured in that CLI, and the picker falls back to manual entry with that reason.
- **Agent switching:** a session can be re-parented to another installed, authenticated agent via `POST /api/sessions/:id/switch-agent`. The new CLI starts fresh: repository state, the task, and the current diff carry over, but the prior conversation does not, and the session records that disclosure. Model ids belong to one CLI's catalog and are never transplanted across agents: switching drops the selected model (the disclosure message names the dropped id) and the new agent starts on its own configured default. Switching is refused while a CLI turn is running, for completed sessions, and on dirty working trees.
- **Context manifest:** every agent turn records a manifest (project/branch, task, acceptance criteria, constraints, candidate files from `git ls-files`, the agent's tool set, and dirty-tree state) in the session, surfaces it as a collapsible detail in the UI, and passes a rendered version to the CLI prompt.
- **Pi Agent:** `pi -p --mode json …`; turns use a session file outside the project. Pi supports `/login` in its interactive TUI, but does not expose a supported device-login API for this browser UI. Use `pi` then `/login` in a terminal; ADE does not fake a sign-in. The provider whose auth Pi reports ready is passed explicitly.

The CLI versions and authentication methods were checked against the installed CLIs and their current documentation: [Codex authentication](https://developers.openai.com/codex/auth/), [OpenCode CLI](https://opencode.ai/docs/cli/) and [providers](https://opencode.ai/docs/providers/), [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). ADE never asks you to paste a token. Some CLIs store credentials in their own user-level files rather than the OS keychain; ADE leaves that choice to the supported CLI flow.

## Safety and current limitations

- ADE refuses to start an agent while Git reports any staged, unstaged, or untracked changes. Commit or stash first; ADE never stashes, resets, checks out, or automatically restores files. It allows one running task per project.
- Codex is invoked with its `workspace-write` sandbox; ADE never passes Codex's dangerous sandbox-bypass flag. OpenCode is not started with `--auto`. ADE does not itself execute deployments or external/shared-system changes.
- Agent-specific interactive approval/question protocols are **not yet bridged to this UI**. An agent may stop, fail, or report a question in its response; ADE shows the real output and lets you follow up. While a CLI turn is still running, follow-ups are queued and sent as the next turn, not injected mid-turn. Do not treat the current UI as a per-tool approval gate.
- Provider quota/rate-limit failures are detected from the CLI's own wording and reported as a distinct, recoverable state (with the provider's retry hint when given) — never as success, and never substituted with simulated output. Model- and provider-level failures get their own recoverable states from the same real wording: a rejected model id (`model_not_found`, including the CLI's own "did you mean" suggestions), an unusable provider (`provider_unavailable`), refused sign-in (`auth_expired`, with recovery via that CLI's own sign-in flow), and exceeded context (`context_overflow`). **A listed model is not an entitlement guarantee** — listings are account-scoped and some models are plan-gated; only the CLI at run time decides, and its error is surfaced honestly with nothing changed in the project.
- Changing a model mid-conversation applies from the next turn. Whether a CLI preserves conversation context correctly under a different model is **not verified** per CLI (OpenCode and Codex accept the flag on continuation; semantics may differ); the session view states this rather than pretending the swap is inert.
- Deliberately deferred: per-project default model, a catalog-wide (not just credential-filtered) model browser, and reasoning-effort/variant selection — OpenCode silently drops unmatched `--variant` values, and ADE will not silently drop a user's reasoning choice, so the feature waits for honest end-to-end support.
- Project check scripts execute project code and can have side effects. ADE runs none automatically; “Run project checks” asks for confirmation first and reports the actual command, exit status, and output. Missing scripts are not represented as passes.
- The dev-server controls only start a detected local `dev` package script, pass a loopback host/port, capture real stdout/stderr, and stop the process. Projects without a detectable script have no server control.
- Claude Code is deferred. There is no ADE cloud service or telemetry. The original type direction is preserved with locally bundled OFL-licensed fonts (licenses are in `public/licenses/`); the UI makes no third-party font requests.

## Architecture

The existing TanStack Start/React app and warm workbench visual direction are retained. A small Node local-service module is mounted into Vite dev/preview and the self-hosted Node server. Agent adapters are isolated in `src/local/adapters/` so additional CLIs can be added without changing UI state. The service owns project registration, Git inspection/diffs, task persistence, child-process lifecycle, CLI streaming, checks, and development servers. The browser polls that loopback API; browser storage is no longer the source of truth.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
