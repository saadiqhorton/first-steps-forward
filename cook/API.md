# Customize ADE: architecture and API contract (round 1)

Owner: main thread. Builders follow this; propose changes in their report rather than diverging silently.

## Storage (all under ADE's data dir, `DATA_DIR = ~/.ade`, private perms 0o700/0o600)

```
<DATA_DIR>/self/
  state.json        customize state (setup, changes, current build, switch, update)
  source/           the private copy: a git repo, node_modules installed here
  builds/<sha>/     snapshot of a kept version (round 3)
  homes/<name>/     throwaway HOME dirs for checks and previews
  backups/          workspace.json backups before a switch (round 3)
```

Git inside `source/` (never shown to users): branch `stock` holds one commit per ADE release imported ("ADE 0.1.15"); branch `mine` = stock + one commit per kept change (commit message = change title); work happens on `change/<id>` branched from `mine`. Only one change is in progress at a time. All git calls are argv spawns with `-c user.name=ADE -c user.email=ade@localhost -c commit.gpgsign=false`, cwd = source.

## Where the stock source comes from

Resolve ADE's own root from the module location (not `process.cwd()`). If `<root>/self-source/` exists (the npm package, round 4), copy it. Else if `<root>` is a git checkout, export tracked files at `HEAD` (`git archive HEAD | tar -x`, or `git ls-files` + copy). Else setup is `unavailable` with a plain reason. Version = root `package.json` version.

## Sessions: the copy is a hidden project

Register one project record `{ id: "ade-self", kind: "ade-self", hidden: true, name: "ADE (your copy)", path: <DATA_DIR>/self/source, ... }` once setup completes. Existing session machinery (`turns.start`, `/api/sessions/:id`, messages, permissions, logs, SSE `session:<id>`) works unchanged. Hidden projects and their sessions are excluded from `bootstrapPayload().projects`, the TopBar, Inbox, organization/handoff discovery and any project counts; sessions remain readable by id. The agent runs with `permission: "build"`, cwd = source. The first prompt is prefixed with scope rules: work only inside this folder; functionality, tools and features only; never edit `src/tokens.css`, `src/styles.css`, `design/`, `src/components/ui/`, `src/components/arc/`; do not start servers; add or update tests for behaviour you change; the user will try the change in a preview.

## Change lifecycle

`working` (agent turn running) → turn ends → if the branch has no file changes: `needs-you` with reason "The agent finished without changing anything." → else commit the work on `change/<id>` (ADE commits, message = title) and `checking` → all checks pass: `ready`; a check fails: `fixing` (ADE sends the agent one follow-up with the failing check name and the last 80 lines of output, max 2 automatic attempts) → back to `checking`; after 2 failed attempts: `failed`. User follow-ups to the agent are allowed in `ready`, `failed`, `needs-you`; they return the change to `working`.

`Keep it` (only `ready`): squash-merge `change/<id>` into `mine` as one commit, status `kept`, store `commit`; set `switch.status = "pending"` (round 3 performs the restart; round 1 just records it and the UI says "Restart ADE to use it" when no launcher is present). `Undo` (any non-kept status): stop the agent turn if running, check out `mine`, delete the branch, status `undone` (hidden from lists). `Remove` (kept): `git revert` that commit on `mine`; on conflict, abort and set the change `needs-you` with reason; success → status `removed`, `switch.status = "pending"`.

Title: first line of the request, trimmed to 60 chars, until the agent's first reply; then keep it (no LLM call to retitle in round 1).

## Checks (run in `source/` with `HOME`/`USERPROFILE` = a throwaway home, never the real home)

| id | label | command |
|---|---|---|
| typecheck | Typecheck | `npm run typecheck` |
| lint | Lint | `npm run lint` |
| build | Build | `npm run build` |
| test | Tests | `npm test` |
| token-audit | Design tokens | `npm run token-audit` |
| design-lock | Design files untouched | internal: `git diff --name-only mine...change/<id>` must not include locked paths |

Sequential, stop-on-first-failure is NOT used: run all, so the user sees every result. Store per check: status, durationMs, a one-line summary (e.g. "412 passed", "1 failed"), and the last 200 lines of output. A missing npm script = `skipped` with that reason. Commands go through the existing spawn helpers (argv, no shell interpolation; Windows npm.cmd handled by `spawn.mjs`).

## Setup

`POST /api/customize/setup`: steps `copy` (copy stock source), `install` (`npm ci` in source with throwaway HOME, progress = lines/time; report bytes if cheap), `save` (git init, stock + mine branches, register hidden project). Status `none → running → ready | failed`. Failure keeps the error text and a Retry; a failed copy leaves no partial `self/` behind.

## HTTP API (NOT in the loopback-only `parts[0]` list: the user decided phones can customize. Remote clients pass the existing token gate like every other mutating route, the same trust level as starting a build-mode agent session today.)

```
GET  /api/customize
  → { available: bool, unavailableReason?: string,
      version: "0.1.15",
      setup: { status: "none"|"running"|"ready"|"failed", step?: "copy"|"install"|"save", progress?: { done: number, total: number|null, label: string }, error?: string },
      changes: Change[],            // newest first; excludes "undone"
      current: { stock: bool, sha: string|null },
      switch: { status: "idle"|"pending"|"waiting"|"restarting"|"failed", waitingFor?: number, error?: string, launcher: bool },
      update: null | { from: string, to: string, status: "applying"|"done"|"needs-you", changes: { id: string, title: string, status: "applied"|"applying"|"needs-you"|"dropped" }[] } }

Change = { id, title, request, criteria?: string, status: "working"|"checking"|"fixing"|"ready"|"failed"|"needs-you"|"kept"|"removed",
           reason?: string, sessionId: string, agentId: string, createdAt: string, updatedAt: string, keptAt?: string,
           files: { path: string, added: number, removed: number }[],
           checks: { id: string, label: string, status: "pending"|"running"|"passed"|"failed"|"skipped", durationMs?: number, summary?: string, output?: string }[],
           fixAttempts: number,
           preview: { status: "stopped"|"starting"|"running"|"failed", url?: string, error?: string } }

POST /api/customize/setup                         → 202 { setup }
POST /api/customize/changes  { request, criteria?, agentId, model?, effort? } → 201 { change }   (409 if another change is in progress)
POST /api/customize/changes/:id/checks            → 202 rerun checks
POST /api/customize/changes/:id/keep              → 200 { change }   (409 unless ready)
POST /api/customize/changes/:id/undo              → 200
POST /api/customize/changes/:id/remove            → 200 { change }   (kept only)
POST /api/customize/changes/:id/preview { action: "start"|"stop" }  → round 2 (return 501 "Preview arrives in a later round" until then)
```

Follow-up messages, stop, permissions: use the existing `/api/sessions/:sessionId/...` routes.

SSE: `eventHub.emit("customize")` on every state change; the client store subscribes to `customize` and invalidates the `["customize"]` query.

## Frontend

- `TopBar.tsx`: `Customize ADE` link (lucide `Wrench`, `.topbar-workspace-link`) right after Luna; a dot like Luna's: teal pulsing while a change is `working|checking|fixing`, amber when `ready|failed|needs-you` or `update.status === "needs-you"`.
- `ProjectsMenu.tsx`: add Inbox, Luna and Customize ADE items for phones (the top nav is hidden below `sm`).
- Routes: `src/routes/workspace.customize.tsx` (layout), `workspace.customize.index.tsx`, `workspace.customize.$changeId.tsx`. Exempt `/workspace/customize` from the full-width section rule so it can own a three-column layout.
- Layout (Workbench, refs W01–W08): left rail "Changes" (+, search, filters All / Needs you / Working / Kept, flat list under All, footer "<n> changes · Show removed"); middle: breadcrumb `Workspace / customize`, change title + status, the session conversation (reuse `SessionMessage`) and the Composer (reuse `Composer`; acceptance criteria collapsible like `NewTaskForm`), Try it / Keep it / Undo row above the composer; right panel (route-owned, collapsible to an icon rail): Preview (round 2: `AgentComputerPane` scoped to project `ade-self`; round 1 shows the honest state "Preview arrives in a later round" only in dev builds, otherwise hidden), Checks, Changes (files list with +/-).
- Empty/ready state (no change selected): start screen from R01: "What should ADE do differently?", subline "Describe a change and an agent builds it in your own copy of ADE", three suggestion cards ("Copy a session's full log", "Stop idle dev servers", "Add a keyboard shortcut") that fill the composer, then the composer.
- First visit (setup none): empty state with "Set up customization", "One time. Downloads about 0.7 GB of build tools and takes a few minutes." Running: step list + progress. Failed: error + Retry.
- Kept list with Remove (in-page confirm, no `confirm()`), `ade --stock` hint.
- Use only existing tokens/components/utilities; `npm run token-audit` zero errors; sentence case; no slop list items.

## Round 3: launcher, kept versions, restart

### Storage additions

```
<DATA_DIR>/self/
  current.json      { sha: string|null, version, previous: { sha: string|null } | null }  (sha null = stock)
  builds/<sha>/     git-archive export of `mine` at sha; node_modules -> source/node_modules (symlink/junction); .output
  backups/<ISO>.json  workspace.json copies taken right before a restart; newest 5 kept
```

Keep/Remove → `switch.status = "preparing"`: the kept version is built into `builds/<sha>.partial`, renamed when done. On Keep, the checks' own `.output` is copied in (no rebuild) when `mine`'s tree equals the tree the checks built; otherwise `npm run build` runs there with a throwaway HOME. When `mine`'s tree equals `stock`'s (every kept change removed) no build is made and `current.json.sha = null`. Then `current.json` is written (old one becomes `previous`), builds are pruned to current + previous, and the switch is `pending`. Plain `ade` starts whatever `current.json` names, so a kept change is used on the next start even without pressing Restart.

### API

```
GET /api/customize
  current: { stock: bool, sha: string|null, withoutChanges?: true }      // withoutChanges: `ade --stock` with kept changes present
  switch: { status: "idle"|"preparing"|"pending"|"waiting"|"restarting"|"failed",
            target?: string|null,         // the version being prepared / switched to
            waitingFor?: number,          // agents working|verifying anywhere in the workspace
            waitingForChecks?: true,      // a change's checks are running
            step?: "build"|"start",       // what failed
            error?: string, output?: string,   // build failure: last 40 lines
            rolledBack?: true,            // the version did not start; ADE went back (error = reason)
            restartedAt?: string,         // the last restart landed on its target
            launcher: bool,               // something can restart ADE for the user
            command?: string }            // only when launcher=false: e.g. "ade", "ade --port 3212", "npx @dezignerdrugz/ade"
POST /api/customize/restart   → 202 { switch }   (409 "Restart ADE to use your changes: stop it and run `<command>`." without a launcher;
                                                   409 "There is nothing new to restart into." unless pending|preparing|failed-at-build;
                                                   failed-at-build retries the build)
Change.checks[].failures?: string[]   // failed checks only: "test name: first error line", tsc `error TS…` lines,
                                      // "file.ts:12 message (rule)" for eslint, else first error-looking / last lines; max 8
```

Restart: `waiting` (polls every second; no session `working|verifying` in the whole workspace, no change `checking`, build ready) → workspace.json backup → `restarting` (state flushed) → the launcher restarts. The next server reconciles: on the target → `idle` + `restartedAt`; rolled back → the supervisor already wrote `failed` + `rolledBack` + `error`.

Automatic fix prompts: the agent still receives the full prompt (now with a "What failed:" list before the last 80 lines); the conversation message carries `presentation: { kind: "ade", text: "ADE sent the failing Tests output to the agent (attempt 1 of 2)", references: [] }`. UI: render `presentation.kind === "ade"` user messages as a compact system row (SessionMessage/types.ts are shared files, not owned by either builder; until then it shows as a short one-line user bubble). Client-sent presentations cannot set `kind` (readMessagePresentation drops it).

### Launcher (bin/ade.mjs, src/local/supervisor.mjs, src/local/launcher.mjs)

- `ade` with a usable kept build in `current.json` and no `--stock` → supervisor: spawns `node builds/<sha>/bin/ade.mjs --port N [--host H|--remote]` detached (own process group) with IPC and env `ADE_SUPERVISED=1`, `ADE_RUNNING_SHA=<sha>` (`ADE_LAUNCH_QUIET=1` on restarts). Env, not a `--child` flag, so builds whose bin predates round 3 still start. The child prints the usual "ADE is running" lines (remote links included); `--open` is done by the supervisor after the first successful probe. `--port 0` gets a fixed free port first.
- Restart: child sends `{ type: "ade:restart" }` over IPC (or exits 75). Supervisor SIGTERMs the child's group (SIGKILL after 10 s), starts the version `current.json` names on the same port, probes `/api/bootstrap` for 30 s; on failure stops it, rewrites `current.json` to `previous` (or stock), writes `switch {status:"failed", step:"start", rolledBack, target, error: last 6 output lines}` into state.json, prints "Your version didn't start, so ADE went back. Reason: …", and starts that.
- Signals (SIGINT/SIGTERM/SIGHUP) are forwarded to the child's group; the supervisor's exit SIGKILLs it. A supervised child whose supervisor dies outright (IPC disconnect) kills its own group. Previews under a supervisor are spawned in the server's group (not detached), so they die with it.
- No kept build, or `--stock`: one process exactly as before (ADR 0002). `--stock`: `launcher=false`, `current.withoutChanges=true` when a kept version exists.
- Stock one-process `ade` CAN hand off: Restart closes the listener, runs ade-local `stop()` (the same path Vite reloads use) and runs the supervisor in the same process on the same port, so the terminal and Ctrl+C keep working. Dev server / `npm start` → `launcher=false` + `command`.
- Known limits: kept builds share `source/node_modules`, so a later change that changes dependencies also changes them for older kept builds; `current.json.version` is recorded but an ADE upgrade does not yet re-apply changes (round 4).

## Round 4: updates, shipped source, kept-build dependencies

### Updates

On start (and `POST /api/customize/update/check`) ADE compares the version it runs as stock with `state.json.stockVersion` (set at setup; older states read it from the `stock` branch's last commit "ADE x.y.z"). "Running stock version" = `package.json` of `ADE_STOCK_ROOT` when set, else the code's own root. The supervisor sets `ADE_STOCK_ROOT` for a kept build to its own package root, so a freshly installed npm version is what a kept build is updated to. Only the first of these starts an update; it never starts while a change is in progress or the switch is `preparing|waiting|restarting`.

Re-apply runs in a separate git worktree `self/update/work` (branch `update-work`, with its own `npm ci` when the new version's package.json/package-lock.json differ from what the copy installed; else `node_modules` is linked), never in `source/`, so the running kept build is untouched and `current.json` does not change until the update is complete. Steps: import the new stock as one commit (`ADE <to>`, kept on branch `update-import` until the end), cherry-pick every kept change in the order it landed on `mine`; a conflict starts a hidden-project (`ade-self-update`) agent session "Re-apply this change to ADE <to>: <title>. Original request: …" with the conflicted files; after all apply, the full checks run in the worktree (design-lock compares against the new stock). A failing check is attributed to the change whose files appear in the failure output (else the last change) and goes to the agent. At most 2 agent attempts per change (attempt 2 reuses the session); then the change is `needs-you` and the update stops there. Done: `stock` moves to the import commit, `mine` to the result, `switch` is built and `pending`; the update clears itself once the restart landed (or immediately when nothing is left to restart into). With no kept changes the move is silent (`update` stays null). New changes are refused (409) while an update is `applying|needs-you`.

```
GET /api/customize
  update: null | { from, to, status: "applying"|"done"|"needs-you", reason?: string,   // reason: a failure not tied to one change
                   checks?: { id, label, status, summary? }[],                          // the full checks after all apply
                   changes: { id, title, status: "applied"|"applying"|"needs-you"|"dropped", reason?, sessionId? }[] }
                   // "applying" also means "not reached yet". sessionId = the agent's hidden conversation (readable by id).
POST /api/customize/update/check                       → 202 { started: bool, reason?: string, update }
POST /api/customize/update/retry { changeId }           → 202 { update }   (409 unless that change is needs-you; the agent starts afresh, 2 attempts)
POST /api/customize/update/skip  { changeId }           → 202 { update }   (change → "dropped"; the kept Change becomes status "removed" with reason "Left out of the update to ADE <to>.")
POST /api/customize/update/stay                         → 200 { update: null }   (abandons the attempt: agent stopped, worktree and branches removed, stock/mine untouched; the same version is not offered again, the next one is; 409 once `done`)
```

Dev/test hook: env `ADE_SELF_STOCK_SOURCE=<dir>` overrides the stock source and version: `<dir>` holds a source tree with a `package.json` whose `version` is newer (node_modules, .git, .output inside are skipped when imported). Set it before starting ADE (setup should have happened on the real stock first); no publish needed. The UI harness uses it for S05.

### Shipped source

`scripts/package.mjs` stages `self-source/`: `git ls-files` of the repo minus `node_modules .output artifacts cook cook-archive tmp .pack` and secret-like files (`.env*`, `*.pem`, `*.key`, `settings.local.json`, `remote-token`; selected out, then `assertNoSecrets` fails the package if any is staged). 546 files, 4.2 MB unpacked; tarball 1.55 -> 2.44 MB (+0.89 MB packed). The resolver already prefers `<root>/self-source`.

### Kept-build dependencies

A build links `source/node_modules` only when its package.json + package-lock.json hash equals the hash the copy installed from (`state.installedDeps`, set at setup; older states derive it from the first `stock` commit). Otherwise the build runs its own `npm ci` (throwaway HOME) in `builds/<sha>.partial`. After an update with changed dependencies the copy's `node_modules` is replaced by the update's own install once the restart landed. Known limit: a previous build that still links `source/node_modules` sees the new dependencies after that.
