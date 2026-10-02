# Handoff: ADE "Agent Computer" — finish, verify, and sync

You are picking up an in-progress feature in **ADE**, a local, self-hosted workspace that drives coding-agent CLIs (OpenAI Codex, OpenCode, Pi). Read this whole file before acting. The previous session ran long, made some wrong turns, and the user wants a fresh agent to land it cleanly.

## The goal (user's words, paraphrased)

Replace ADE's right-pane **Preview** (iframe + "Start development server" + attach-a-port form + Processes list) with an **Agent Computer**: an isolated Linux desktop (Docker container) that the **agent itself controls** — screenshots, mouse, keyboard, a Chromium browser — to run and manually test the user's project, like Cursor Cloud Agents / Grok computer use. The user watches it live in ADE and can take control. It must be **free and run on the user's machine** (no E2B/cloud). It must work for **all three agents: Codex, OpenCode, and Pi**. When done, **both copies of the repo (Windows and WSL) must have the work and both must run**.

## Where things are (critical — this caused confusion before)

- **Work here:** `C:\Users\admin\first-steps-forward` (Windows; from WSL: `/mnt/c/Users/admin/first-steps-forward`). Branch `main` at `2c5bbc1`. `origin/main` is still `39a1325`.
- **The WSL copy** `\\wsl.localhost\Ubuntu-22.04\home\dezignerdrugz\first-steps-forward` (`~/first-steps-forward` in Ubuntu-22.04) is where the user's latest work lived. The user runs ADE from it at `http://localhost:3100`. It is **untouched** by this work so far. At the end you must sync the finished work back to it (user request).
- The Windows repo was migrated to match WSL this session: its `main` was **fast-forwarded** (no rewrite) to WSL's 28 local commits, then WSL's 77 modified + 43 untracked files were copied over (verified byte-identical, line endings aside). Then the agent-computer work was applied on top.
- **Backups of everything replaced:** `git stash@{0}` (old Windows uncommitted edits + a first agent-computer attempt on the *old* code) and `C:\Users\admin\ade-migration-backup-20261002\` (patch, tar of files, `wsl-status.txt`, the copy script, lockfile before adding cross-spawn). `scripts/check-task-accessibility.mjs` existed only in the old Windows tree; it is in the stash/backup, not in the working tree — ask the user if they want it back.

## Rules (from AGENTS.md and the user)

- The repo is connected to **Lovable**: never force-push or rewrite pushed history; commits pushed to `main` sync to Lovable. **Do not commit or push unless the user asks.** Everything below is currently **uncommitted**.
- Don't touch the user's own unrelated uncommitted files (most of the working tree is the user's WSL work in progress).
- Ports: the user's WSL ADE uses **3100**; 8080 is taken; use **8090** for this checkout's dev server (`npx vite dev --port 8090`). The service code (`src/local/ade-local.mjs`) is imported by `vite.config.ts`, so **restart the dev server after backend edits** (no HMR). Vite's log has ANSI codes — poll `http://127.0.0.1:8090/api/bootstrap` instead of grepping "Local:".

## Architecture (implemented)

| Piece | File(s) | State |
| --- | --- | --- |
| Computer image | `docker/agent-computer/{Dockerfile,start.sh,computer-server.py}` | Done, live-verified |
| Lifecycle manager (build/start/stop/status/action) | `src/local/computer.mjs` (+ `computer.test.mjs`) | Done, tests pass, live-verified |
| MCP server for Codex/OpenCode | `src/local/computer-mcp.mjs` (+ test) | Done, tests pass |
| Pi extension (Pi has no MCP) | `src/local/computer-pi-extension.mjs` | Written, **never run live** |
| Per-CLI wiring | `src/local/adapters/computer-tools.mjs`, `codex.mjs`, `opencode.mjs`, `pi.mjs` (+ `adapters.test.mjs`) | Done, 16/16 tests pass |
| Service integration | `src/local/ade-local.mjs` | Ported; not yet live-tested on the new code |
| UI | `src/components/ade/AgentComputerPane.tsx`, `Shell.tsx` (tab "Computer"), `store.tsx`, `types.ts`, `navigation.ts`, `routes/processes.tsx`, `routes/p.$projectId.conversations.tsx`; `PreviewPane.tsx` + `ProcessPanel.tsx` deleted | Typechecks; **not visually verified** |
| Windows process launching | `src/local/spawn.mjs` (+ `spawn.test.mjs`, 4/4 pass) | Written, **not wired in yet** |

How it works:
- **One computer per project**, container `ade-computer-<projectId>`, labels `ade.computer=1`, `ade.project`, plus its random VNC password and control token as labels (so ADE re-finds it after restart without storing secrets). Ports published on `127.0.0.1` only: noVNC `6080` (human view, iframe in the pane; view-only by default, "Take control" toggle) and control API `7000` (token header `X-ADE-Token`). `--cap-drop ALL`, `no-new-privileges`, 2 CPU / 2 GB / 1 GB shm. Image tag = hash of the three image files; ADE rebuilds automatically when they change.
- **Image:** `FROM selenium/standalone-chromium@sha256:08fd2936…` (Chromium 152, Xvfb, fluxbox, x11vnc, noVNC already inside). **No `apt` step on purpose** (see "Network" below). The control server is pure Python stdlib + `ctypes` (libX11/libXtst): XTest for mouse/keys (handles shifted symbols and remaps a spare keycode for unmapped chars), `XGetImage` → PNG via `zlib`, and a socket relay that makes `localhost:PORT` inside the computer reach the host's dev server via `host.docker.internal` (browser keeps a `localhost` Host header, so Vite/Next host checks pass).
- **Dev server stays on the host** (native node_modules, fast watching). ADE's existing dev-server engine is kept but its UI is gone; the agent drives it via `dev_server_start/stop/status` tools.
- **Agent tools:** `computer_screenshot, computer_open_url, computer_click, computer_double_click, computer_move, computer_drag, computer_type, computer_key, computer_scroll, computer_wait, dev_server_status, dev_server_start, dev_server_stop`. Every action returns a fresh screenshot. Tools call ADE's API `/api/projects/:id/computer/action` (auto-starts the computer) and `/api/projects/:id/dev[/start|/stop]`.
- **Wiring:** Codex gets `-c mcp_servers.ade_computer.{command,args,env,default_tools_approval_mode="approve",startup_timeout_sec,tool_timeout_sec}`; OpenCode gets `OPENCODE_CONFIG_CONTENT` (merged with any existing); Pi gets `-e src/local/computer-pi-extension.mjs` and the tool names added to its `--tools` allowlist, plus `ADE_API`/`ADE_PROJECT_ID` env. `computerContext(project)` in `ade-local.mjs` builds this; adapters may return a 3rd element (extra env) that `runAgent` merges into the spawn env.
- The old curl-based "devControl" bridge + `~/.ade/skills/ade-dev-control/SKILL.md` were removed; the manifest now has `agentComputer` and constraints tell the agent to use the tools and visually verify changes.
- Design doc: `docs/superpowers/specs/2026-10-01-agent-computer-design.md` — **partly stale** (still describes a Debian+apt+xdotool image); update it to the Selenium-base + ctypes design.

## Hard-won facts (don't rediscover these)

1. **Network:** on the user's network `deb.debian.org` (Fastly) runs at 0.3–0.9 MB/s and stalls; Alpine's CDN too. Docker Hub is fast (1 GB in ~51 s). The old apt-based image took 40+ min. Current image builds in ~6 s once the base is pulled. Don't add `apt-get` to the Dockerfile.
2. **Codex `exec`** runs with approval policy `never`, which **denies MCP tools** ("MCP tool call requires approval, but approval policy is never") unless the server sets `default_tools_approval_mode="approve"` (already done). Verified live that Codex then reaches the tools.
3. **Windows `.cmd` shims:** `spawn("npm")` → ENOENT, `spawn("npm.cmd")` → EINVAL (Node CVE-2024-27980 fix). Only via `cmd.exe` works. This breaks dev servers, project checks, `npm root -g`, harness installs, and any npm-installed CLI (e.g. `pi.cmd`) when ADE runs on native Windows. On this machine `codex.exe`/`opencode.exe` resolve to real .exe files, so agents themselves launch.
4. **Windows tests leaked into the real `~/.ade`:** tests set `HOME` but `os.homedir()` uses `USERPROFILE` on Windows. Fixed by also setting `USERPROFILE` in 7 test files. 36 fixture projects the tests had written were removed from the user's Windows `~/.ade/workspace.json`.
5. WSL uses **mirrored networking**; containers reach WSL `127.0.0.1` services via `host.docker.internal` (verified). `wsl.exe` interop is flaky in this environment (`Wsl/Service/0x8007274c` timeouts); file access through `\\wsl.localhost\...` kept working. A `docker build` run *inside WSL* earlier failed with `error getting credentials` (credsStore `desktop.exe`) — re-check now that the base image is already in Docker Desktop's shared store.

## What's left, in order

1. **Wire `spawn.mjs` in** (Windows support, needed for `dev_server_start` on Windows):
   - Replace `spawn(` with `spawnCommand(` at `src/local/ade-local.mjs` ~L167 (`run` helper), ~L884 (`runAgent`), ~L1069 (`spawnProcess`, dev servers), ~L2326 (codex login), and `src/local/harness.mjs` ~L234. Keep `shell: false`, argument arrays.
   - `stopChild` (~L1019): on `win32` call `killTree(pid)` (taskkill /T /F) with the old `child.kill()` as fallback — otherwise the real dev server under `cmd.exe` is orphaned and keeps its port.
   - Add `src/local/spawn.test.mjs` to the `test` script in `package.json` (`computer.test.mjs` and `computer-mcp.test.mjs` are already added). `cross-spawn@^7.0.6` was added as a direct dependency.
   - Expected result: the 3 dev-control tests in `ade-local.model.test.mjs` pass on Windows (they fail on clean HEAD on Windows too).
2. **Run the full suite** (`npm test`, `npm run typecheck`, `npm run lint`). Known pre-existing Windows failures to triage separately: `editor.test.mjs` (whole file) and 2 `terminal.test.mjs` tests. Lint: two prettier errors in an existing WSL test file (`formatLogs`-area), not from this work; ignore CRLF "Delete ␍" noise (Windows checkout uses autocrlf).
3. **Live end-to-end on the new code** (Windows): start ADE on 8090, open it in a browser, confirm the right pane has a **Computer** tab (no Preview/Processes UI anywhere), start a computer from the pane, then run a real Codex task against a small app with a `dev` script, e.g. "start the dev server, open it on your computer, click X, report what you see". A throwaway counter app exists at `%TEMP%\claude\C--Users-admin-first-steps-forward\2e47ab34-74b3-40f0-ab21-26f4cd33b47f\scratchpad\counter-app` (may be cleaned up; it's 2 files: `package.json` with `"dev": "node server.js"` and a tiny http server honoring `PORT`/`HOST`). Then repeat with **OpenCode**. Watch the computer in the pane while the agent works.
4. **Pi:** Pi is installed only in WSL (`/usr/local/bin/pi`). Verify the extension loads (`pi -e <path>/computer-pi-extension.mjs` registers the tools; TypeBox is imported dynamically from `typebox` / `@sinclair/typebox` with a plain-JSON-Schema fallback) and a real Pi turn can call `computer_screenshot`.
5. **Polish:** replace the Selenium wallpaper on the desktop with a plain background (fluxbox `background: none` / `fbsetroot -solid`), update the README (current README is the WSL version — add an "Agent computer" section: requirements = Docker Desktop/Engine, tools, isolation, lifecycle, API; and the dev-server-is-agent-driven note), update the spec doc.
6. **Sync to WSL** (user request): copy every changed/added/deleted file from this working tree to `~/first-steps-forward` in WSL (don't overwrite unrelated WSL changes made since — compare first), run `npm install` there (Linux binaries), `npm test`, and start it on its usual port to confirm the Computer tab works from WSL too (Docker from WSL, `host.docker.internal` → WSL loopback).
7. **Cleanup:** the user's Windows `~/.ade/workspace.json` still has a test project `counter-app` (`9d6cd0ac-…`) and 1 session from live testing — remove via `POST /api/projects/<id>/remove` once done. Docker images left from experiments: `ade-computer:d1e18db63078` (stale tag), `buildpack-deps:bookworm-curl`, `debian:bookworm-slim`, `curlimages/curl:*` — safe to remove; keep `selenium/standalone-chromium` and the current `ade-computer:<tag>`.
8. Report to the user, then ask before committing (and never push without explicit approval).

## Quick verification commands

```bash
npm test
npx tsc --noEmit
npx vite dev --port 8090
curl -s http://127.0.0.1:8090/api/projects/<projectId>/computer
docker ps --filter label=ade.computer=1
```

Smoke-test the computer without an agent (Node, from the repo root):

```js
import { createComputerManager } from "./src/local/computer.mjs";
const m = createComputerManager();
await m.start("smoketest");
console.log(await m.status("smoketest"));            // status "running", viewerUrl
const r = await m.action("smoketest", { action: "open_url", url: "http://localhost:<devport>" });
// r.payload.screenshot is base64 PNG; then: await m.stop("smoketest")
```
