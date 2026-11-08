# ADE — local agent workspace

ADE is an open-source workspace for local coding-agent CLIs. It does not require an ADE account, hosted backend, or relay. The original Lovable screens were a simulation; the current app replaces its seeded projects, generated agent runs, fake sign-in, and fabricated diffs with a Node service that reads the local filesystem and starts the installed CLI processes.

## Run locally

Requirements: Node.js 22+ and Git. Install whichever coding-agent CLI you plan to use. The terminal and browser are optional.

### Quick start

Run ADE without cloning the repository or installing its development dependencies:

```sh
npx @dezignerdrugz/ade
```

Open the printed address (by default `http://127.0.0.1:3100`). To choose a port or open it automatically:

```sh
npx @dezignerdrugz/ade --port 3200 --open
```

### Use it from your phone or another computer

```sh
npx @dezignerdrugz/ade --remote
```

ADE prints a sign-in link next to its usual address:

```text
ADE is running.
  This computer:  http://127.0.0.1:3100
  Your devices:   http://192.168.1.135:3100/?token=…  (same Wi-Fi)
Open a link once on each phone or laptop; it stays signed in. Ctrl+C stops ADE.
Wi-Fi links are plain HTTP: fine at home, not on public Wi-Fi.
```

Open the link on a phone or laptop connected to the same Wi-Fi. It signs that browser in and opens ADE; from then on the plain address (`http://192.168.1.135:3100`) works there too. There is no account, password or configuration:

- **The link stays the same.** ADE makes its access token once and keeps it in `~/.ade/remote-token`. Delete that file to sign every device out; the next `ade --remote` makes a new link.
- **Home networks only.** The Wi-Fi link is plain HTTP, so anyone on the same network could read it in transit. Use it at home, not on public or shared Wi-Fi.
- **Tailscale is optional.** If [Tailscale](https://tailscale.com) is already connected, ADE adds a second link that works from your Tailscale devices wherever they are: HTTPS through `tailscale serve` while ADE runs (when your tailnet has HTTPS certificates turned on), otherwise the plain tailnet address. Nothing is left in your Tailscale settings when ADE stops.
- **Some tools stay on this computer.** The built-in terminal, the file editor, and installing or updating agent CLIs work only on the computer running ADE.
- **Another port:** `ade --remote --port 3200`. Ctrl+C stops ADE, and the links stop working until you run `ade --remote` again.

If the link does not open on the other device, check that both are on the same network (guest and office networks often keep devices apart), that this computer's firewall allows incoming connections on ADE's port, and that this computer's address has not changed since ADE started.

Check this machine's setup with `npx @dezignerdrugz/ade doctor`. The built-in terminal is optional; when its platform binary is unavailable, the rest of ADE still works. `ade browser-setup` explains or installs host packages needed by Chrome on supported Linux systems.

### Run from source

For development, clone the repository and install its development dependencies:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:3100` (the dev server is pinned there, the same port the installed `ade` uses, so run one at a time; override with `npm run dev -- --port <n>`). The development server and API bind to `127.0.0.1` by default, not the LAN; `ADE_HOST`/`ADE_TOKEN` (below) apply to `npm run dev` too, and a non-loopback `ADE_HOST` without `ADE_TOKEN` makes the dev server refuse to start. To run the built, self-hosted Node server instead:

```sh
npm run build
npm start
```

That server listens on `127.0.0.1:3100` (override with `PORT=... npm start`). To share a source checkout with your other devices the easy way, run `node bin/ade.mjs --remote` after `npm run build` (see **Use it from your phone or another computer** above); the rest of this paragraph describes the manual settings it uses. It stays loopback-only unless you explicitly opt in: set `ADE_HOST` (or pass `ade --host`) to a LAN/Tailscale interface address (or `0.0.0.0`) **and** `ADE_TOKEN` to a non-empty secret (`openssl rand -hex 16`); without a token `scripts/start-local.mjs` refuses to listen on a non-loopback address and exits 1. In exposed mode every `/api` request from a non-loopback client must prove the token — as `Authorization: Bearer <ADE_TOKEN>` for scripts, or via an `HttpOnly` `ade_auth` cookie that the UI's token gate obtains by POSTing the token to `/api/auth` once (wrong tokens get 401). A specific `ADE_HOST` also compares the request's Host header against that address as a DNS-rebinding fence; `ADE_HOST=0.0.0.0` (or `::`) spans every interface and accepts any Host name, with the token remaining the gate. Loopback clients — the agent CLIs and ADE on this machine — are exempt from the token either way. Plain HTTP carries the token in the clear, so prefer a Tailscale address, or keep the default loopback bind and front it with `tailscale serve --bg https / http://127.0.0.1:3100`: requests then arrive from the local proxy and the remote browser gets HTTPS. Without `ADE_TOKEN` the proxy is the only gate; with it, proxied browsers must prove the token too (a tailnet can include other people). Opening any ADE page with `?token=<ADE_TOKEN>` signs that browser in the same way, then reloads the page without the token so it does not stay in the address bar.

Add a project from the **+** button, in one of three ways: pick an **existing folder** (the native picker when available, ADE's own folder browser otherwise, or type its local path); **clone from GitHub** into a folder you choose (`owner/repo`, a GitHub URL, or an SSH address — runs `git clone` with prompts disabled, so a private repository needs `gh auth login`, a git credential helper, or an SSH key in `ssh-agent`; addresses carrying a password and non-remote paths are refused); or make a **new folder**, optionally initialized as a Git repository. The folder browser has a **New folder** button for creating a destination. A failed clone removes whatever it partially wrote, and an existing folder is never overwritten. To drop a project from the workspace, use **Remove** in the project header: it deletes only ADE's metadata (session records, process entries) for that project after an explicit confirmation, and never touches the folder or its files.

ADE stores project/session metadata in `~/.ade/workspace.json` and CLI logs in per-session JSONL files under `~/.ade/session-logs/` (private file permissions); Pi session files are under `~/.ade/sessions/`. Project files are not copied into ADE, and provider credentials are not written to ADE or project files.

## Agents and authentication

ADE detects the installed executable and asks that CLI to report its current auth state. It invokes agents with argument arrays (no shell interpolation):

- **OpenAI Codex:** `codex exec --json --cd <project> --sandbox workspace-write …`; resume uses Codex's session ID. `codex login --device-auth` is an actual supported device sign-in flow and can be started from ADE. Codex's own CLI manages its credentials.
- **OpenCode:** `opencode run --format json …`; the project comes from the working directory ADE spawns the CLI in (`opencode run` has no directory flag), and follow-ups resume its session. Provider credentials are managed by OpenCode (`opencode auth login`) in its user-level data directory. OAuth availability depends on provider; ADE does not claim every provider supports a browser flow.
- **Model picker:** each task can optionally run on a specific model. ADE reads the installed CLI's own quota-free, cache-backed listing (`codex debug models`, falling back to `--bundled` offline; `opencode models`; `pi --offline --list-models`) — it never refreshes catalogs over the network and never ships a static stand-in list, so what you see is what that CLI currently exposes for the providers configured in it. The chosen model is passed as `-m`/`--model` (`codex exec`, `codex exec resume`, `opencode run`, `pi --model provider/id`); leaving it unset omits the flag entirely so the agent uses its own configured default. The model is recorded in the session's context manifest and shown in the session header. A model id is only charset-validated (first character alphanumeric, so it can never read as a CLI flag; then letters, digits, `. _ / : [ ] - +`, max 256) and is passed verbatim in the argv array — ADE runs no shell, and model ids are split on the first `/` only by the CLI that receives them. Explicit ids always win: ADE never gates a chosen model against the listing and never invents entitlement checks beyond that; the CLI is the authority and its real rejection is surfaced (see below). You can change a session's model from the session header; the change applies from the next CLI turn (a turn already running keeps its current model), and the picker's "Other model id…"/free-text entry covers accounts whose catalog cannot be enumerated.
- **Model listings are cached** in memory and in a private `~/.ade` file (0600) keyed by agent **and CLI version** (a replaced/upgraded CLI cannot serve a stale list), with a 300-second freshness window; the listing being empty is not an error, it means no provider is configured in that CLI, and the picker falls back to manual entry with that reason.
- **Agent switching:** a session can be re-parented to another installed, authenticated agent via `POST /api/sessions/:id/switch-agent`. Switching only saves the selected agent and its model options; it does not start an agent turn. The next user message starts a fresh conversation with the selected agent. The repository state, task, and current diff carry over, but the prior conversation does not, and the session records that disclosure. Model ids and model-scoped options are validated against the selected agent. Switching is refused while a CLI turn is running and for completed sessions.
- **Context manifest:** every agent turn records a manifest (project/branch, task, acceptance criteria, constraints, candidate files from `git ls-files`, the agent's tool set, and dirty-tree state) in the session, surfaces it as a collapsible detail in the UI, and passes a rendered version to the CLI prompt.
- **Pi Agent:** `pi -p --mode json …`; turns use a session file outside the project. Pi supports `/login` in its interactive TUI, but does not expose a supported device-login API for this browser UI. Use `pi` then `/login` in a terminal; ADE does not fake a sign-in. The provider whose auth Pi reports ready is passed explicitly.
- **Claude Code:** ADE detects your own `claude` on `PATH` however you installed it (Anthropic's installer, npm, Homebrew, mise…), checks its sign-in with `claude auth status --json`, and runs that same `claude`; you sign in with `claude auth login` in a terminal. Only when `claude` is missing does the agent picker offer Install, which runs `npm install -g @anthropic-ai/claude-code`. Turns run over the [Agent Client Protocol](https://agentclientprotocol.com) through Claude Code's ACP bridge, `claude-agent-acp`: a copy already on `PATH` is used, otherwise ADE installs the version it was tested with (`@agentclientprotocol/claude-agent-acp@0.99.0`) once under `~/.ade/acp`, the first time it needs it (opening Claude's model list or its first task; about 70 MB, a few seconds, and a task says so). That copy leaves out the bridge's own bundled Claude Code binary, because ADE points the bridge at yours with `CLAUDE_CODE_EXECUTABLE`. Each turn spawns the bridge and drives it over JSON-RPC on stdin/stdout (`src/local/acp.mjs`): `initialize`, then `session/resume` (or `session/load`) on follow-ups, else `session/new`, then the mode, the model, and the prompt. ADE advertises no file-system or terminal capability, so Claude keeps its own tools; it never offers Claude's bypass-permissions mode. **Build** selects Claude's _Accept edits_ mode and **Plan** its _Plan_ mode. ACP has no list command, so for the model picker ADE opens a Claude session that is never prompted and saves nothing (`persistSession: false`, auto-memory off), reads the models it offers, and keeps that list per Claude Code version (turns refresh it); the picker offers only those ids, and a remembered model Claude does not offer falls back to its default; a chosen model is applied through Claude's own model option, and an id it does not offer fails the turn with the ids it does.

The CLI versions and authentication methods were checked against the installed CLIs and their current documentation: [Codex authentication](https://developers.openai.com/codex/auth/), [OpenCode CLI](https://opencode.ai/docs/cli/) and [providers](https://opencode.ai/docs/providers/), [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), [ACP v1](https://agentclientprotocol.com) and `@agentclientprotocol/claude-agent-acp` 0.99.0 with Claude Code 2.1.307 (design: `docs/superpowers/specs/2026-10-28-acp-adapter-design.md`). ADE never asks you to paste a token. Some CLIs store credentials in their own user-level files rather than the OS keychain; ADE leaves that choice to the supported CLI flow.

## Agent browser

Each project's right pane has a **Browser** tab: a headless Chrome on your machine that the **agent itself drives** — page snapshots, screenshots, mouse, keyboard — to run and manually test your project, the way Cursor Cloud Agents or Grok computer use do, but fully local. You watch it live in ADE and can take control with the **Take control** toggle. It works like T3 Code's server browser (see `THIRD_PARTY_NOTICES.md`); there is no cloud service, no container, and nothing leaves your machine.

**Setup:** none. The first time a project's browser starts, ADE downloads Chrome for Testing's headless shell (one pinned release, about 100–120 MB) into `~/.ade/tools/chrome-headless-shell/` and checks it against the pinned size and SHA-256 before unpacking; the Browser tab shows the download progress, and every project reuses that copy. Opening the tab starts the browser (about a second). If Chrome cannot start, the pane and the agent's tools say why: missing shared libraries, an AppArmor policy that blocks Chrome's sandbox (Ubuntu 23.10+), or running as root. `npm run browser:setup` fixes the first two on apt-based Linux (it explains what it would do and asks for `sudo` when needed); elsewhere it names the missing libraries for your package manager. Chrome for Testing has no headless shell for every platform (for example 32-bit Linux); there the pane reports the browser as unavailable.

**Isolation:** Chrome runs headless with its own sandbox on (only `ADE_BROWSER_SANDBOX=0` turns it off). Playwright launches it over a pipe, so no DevTools port is opened and it exits with ADE. Each project gets its own profile under `~/.ade/browser/profiles/`, separate from your own browser: **keep logins** (the default) keeps that project's cookies and storage between runs, and **incognito** starts clean every time; **clear** deletes the stored profile, as does removing the project. ADE navigates only to http(s) URLs, and pages see an ordinary Chrome rather than `HeadlessChrome`, so sign-in pages and bot checks treat them like a normal browser. Unlike the old Docker computer, the browser runs as your user on your network, as the agent CLI already does.

**Passkeys and native browser dialogs:** the default headless shell cannot show operating system passkey dialogs. To use a local full Chrome or Chromium build instead, exit ADE and start it with `ADE_BROWSER_HEADED=1` and `ADE_BROWSER_EXECUTABLE` set to the absolute executable path. For example, on Linux:

```sh
ADE_BROWSER_HEADED=1 ADE_BROWSER_EXECUTABLE=/usr/bin/chromium npm run start
```

On macOS, the executable may be `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; quote the path when setting the variable. On Windows PowerShell, set `$env:ADE_BROWSER_HEADED = "1"` and `$env:ADE_BROWSER_EXECUTABLE` to the full path of `chrome.exe` before starting ADE. Use a browser build that supports the passkey provider or security key on your system. A graphical desktop must be available where ADE runs. The full browser opens a separate local window for its own dialogs; continue working in that window when prompted. Its page is also streamed into ADE, with the same agent tools and project and tab isolation. Close ADE and restart without these variables to return to headless mode.

The two modes keep their profiles and logins in separate directories (`~/.ade/browser/profiles/` and `~/.ade/browser/profiles-headed/`). This prevents a newer system browser from upgrading the pinned headless browser's data. Existing logins do not transfer automatically; use ADE's browser import when needed. Clearing a profile removes its data in both modes. Private browsing remains temporary in either mode. Operating system and browser support differ: in particular, available passkeys, hardware keys, and biometric prompts depend on the selected browser, its signing and platform integration, and the local system.

**Agent tools:** every agent gets the same toolset — `browser_*` tools that work on the page's accessibility snapshot (`browser_status`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select`, `browser_upload`, `browser_dialog`, `browser_screenshot` and the rest), `computer_*` tools that work by coordinates on the 1280×800 page (`computer_screenshot`, `computer_open_url`, `computer_click`, `computer_double_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_wait`; each returns a fresh screenshot), and `dev_server_status` / `dev_server_start` / `dev_server_stop` for the project's dev server. The first call starts the browser; during the one-time download a call answers with the progress so the agent can retry. Wiring per CLI: Codex receives the tools as an MCP server (started by Codex itself, so calls work despite its `workspace-write` sandbox); OpenCode receives them through its config; Pi (which has no MCP client) loads a small extension that registers the same tools; Claude Code receives the same MCP server in ACP's `session/new`, pre-allowed with the single rule `mcp__ade_computer` so browser actions never raise a permission prompt. All tools call ADE's loopback API.

**Live view:** the Browser tab streams the page live (screencast over a loopback WebSocket). It docks in the right pane or pops into a draggable floating window, with back, forward, reload, URL and open-externally controls. Click **Take control** to drive it yourself; **Hand back** returns it to the agent. While you control it, agent `browser_*` and `computer_*` calls fail with a `human_control` message until you hand back. Typing goes to the page, including paste and IME composition; on a phone or tablet, tapping an editable field raises the on-screen keyboard and dragging scrolls the page. Links in agent replies and the terminal open here rather than your system browser, as do workspace `.html` and `.pdf` files. The empty state lists web servers already running on this machine. The device toolbar offers presets, free dimensions, rotation, and **Fill pane**, which sizes the page to the pane so responsive layouts match what you see; the menu can pop the page out into its own operating-system window. Text you copy in the page lands on your own clipboard. When the page opens a file picker, whoever drives answers it: you pick files from your computer in the pane, the agent uses `browser_upload`. JavaScript dialogs (alert, confirm, prompt) appear in the pane and to the agent the same way. When the agent opens a page while the Browser tab is not on screen, it floats over the conversation; dock or close it to keep it out of the way.

**Workspace files:** `GET /api/projects/:id/browser/files/<path>` serves a page from inside the project (HTML, PDF, and the page's own CSS, scripts, images and fonts) so the browser can display it. Paths outside the project, dotfiles, and unlisted file types are refused.

**The dev server stays on the host** (native `node_modules`, fast file watching), and so does the browser, so `localhost:<port>` URLs reach it directly. The old Preview tab (iframe + attach-a-port form) and Processes list are gone; the agent starts and stops the dev server itself through its tools, and you watch the result in the browser.

**Upgrading from the Docker computer:** ADE no longer uses Docker. Containers left over from earlier versions can be removed with `docker rm -f $(docker ps -aq --filter label=ade.computer=1)`, and their images with `docker image ls ade-computer` / `docker image rm`.

**On Windows**, npm `.cmd` shims need a shell wrapper to be spawned safely; ADE handles this in its process layer (`src/local/spawn.mjs`) without ever interpolating arguments into a shell, and kills the whole process tree on stop so dev-server ports are actually freed.

## Safety and current limitations

- **Uncommitted work is protected, not blocking.** You can start a task on a dirty working tree (with a one-click acknowledgment). ADE records the pre-existing changes as the session's baseline, passes the file list to the agent with explicit instructions to never revert, stash, commit, or overwrite them, and marks those files "yours" in the diff view so you can tell your edits from the agent's. The baseline is refreshed at the start of every turn, so you can keep editing between turns. ADE never auto-stashes, resets, checks out, or restores files. It allows one running task per project.
- Codex is invoked with its `workspace-write` sandbox; ADE never passes Codex's dangerous sandbox-bypass flag. OpenCode is not started with `--auto`. ADE does not itself execute deployments or external/shared-system changes.
- **Claude Code's approvals are bridged.** When Claude asks before an action (in Build: shell commands, network fetches, files outside the project), the turn pauses, the session shows **Needs you**, and a card lists Claude's own options (for example _Yes_, _Yes, and don't ask again…_, _No_); ADE adds none of its own. "Always" choices are saved by Claude Code itself, which may write them to the project's `.claude/settings.local.json`. Stopping the session drops a pending question. In **Plan**, ADE declines every request to edit, delete, move, run a command, or leave plan mode without asking, and shows the plan Claude prepared as its reply; switch the session to Build and follow up to apply it.
- For Codex, OpenCode, and Pi, agent-specific interactive approval/question protocols are **not yet bridged to this UI**. An agent may stop, fail, or report a question in its response; ADE shows the real output and lets you follow up. While a CLI turn is still running, a follow-up can wait until that turn exits or stop the turn and send immediately. ADE does not inject text into a running CLI process. Do not treat the current UI as a per-tool approval gate.
- Provider quota/rate-limit failures are detected from the CLI's own wording and reported as a distinct, recoverable state (with the provider's retry hint when given) — never as success, and never substituted with simulated output. Model- and provider-level failures get their own recoverable states from the same real wording: a rejected model id (`model_not_found`, including the CLI's own "did you mean" suggestions), an unusable provider (`provider_unavailable`), refused sign-in (`auth_expired`, with recovery via that CLI's own sign-in flow), and exceeded context (`context_overflow`). **A listed model is not an entitlement guarantee** — listings are account-scoped and some models are plan-gated; only the CLI at run time decides, and its error is surfaced honestly with nothing changed in the project.
- Changing a model mid-conversation applies from the next turn. Whether a CLI preserves conversation context correctly under a different model is **not verified** per CLI (OpenCode and Codex accept the flag on continuation; semantics may differ); the session view states this rather than pretending the swap is inert.
- Deliberately deferred: per-project default model, a catalog-wide (not just credential-filtered) model browser, and reasoning-effort/variant selection — OpenCode silently drops unmatched `--variant` values, and ADE will not silently drop a user's reasoning choice, so the feature waits for honest end-to-end support.
- Project check scripts execute project code and can have side effects. ADE runs none automatically; “Run project checks” asks for confirmation first and reports the actual command, exit status, and output. Missing scripts are not represented as passes.
- Dev-server control is first-class and agent-driven. `POST /api/projects/:projectId/dev/start` re-scans `package.json` inline (a project scaffolded earlier in the same turn is detected immediately), maps launch flags to the detected framework, and reports `running` only after the port really accepts a connection; `dev/stop` works during `starting` and is idempotent (with PID-reuse guards, so a recycled PID is never killed); `GET .../dev` returns bounded status (`{found, status, port, command}`, output tail only). Frameworks that reject `--host` (Next) get only `-H 127.0.0.1`; unknown scripts get `PORT` plus `HOST=127.0.0.1` in the environment — the probe cannot verify a wide bind for those, so they are always pinned to loopback. Projects with no dev script can still be started: the agent proposes one program and its arguments (`dev_server_start({ command, cwd })`), the session shows **Needs you** with a **Run this dev command?** card, and once you allow it ADE runs that command itself (no shell, folder inside the project, `PORT`/`HOST` and a project `.venv` on `PATH`) on every later start; the Agent browser pane's Details show it with **Forget** ([ADR 0005](docs/adr/0005-agent-proposed-dev-commands.md)). Without a dev script or an approved command, start gets a 404 telling the agent to propose one — never to fall back to a detached process; double starts get 409 with the current record. Agents drive the same endpoints through their `dev_server_status`, `dev_server_start`, and `dev_server_stop` tools (see **Agent browser**), which call ADE's loopback API from outside the CLI sandbox — the reliable path where a sandboxed shell curl may be blocked.
- Gemini CLI also speaks ACP (`gemini --acp`) but is not offered yet: its permission requests carry no structured tool name, so ADE could not pre-allow its own browser tools there. There is no ADE cloud service or telemetry. The original type direction is preserved with locally bundled OFL-licensed fonts (licenses are in `public/licenses/`); the UI makes no third-party font requests.

## Architecture

The existing TanStack Start/React app and warm workbench visual direction are retained. A small Node local-service module is mounted into Vite dev/preview and the self-hosted Node server: `src/local/ade-local.mjs` holds the request guard and the shared state, each area's API routes live in `src/local/routes/`, and larger services have their own modules (`dev-server.mjs`, `agent-status.mjs`, `remote.mjs` and others). Agent adapters are isolated in `src/local/adapters/` so additional CLIs can be added without changing UI state. The service owns project registration, Git inspection/diffs, task persistence, child-process lifecycle, CLI streaming, checks, and development servers. The browser receives scoped invalidations over Server-Sent Events and loads session details and logs on demand; browser storage is no longer the source of truth.

## License

ADE is released under the [MIT License](LICENSE). Third-party components and bundled fonts keep their own licenses; see `THIRD_PARTY_NOTICES.md` and `public/licenses/`.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
