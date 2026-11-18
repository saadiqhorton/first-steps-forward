# ADE Workspace Assistant — release verification matrix

Companion to [the parity specification](./2026-11-17-joy-for-ade.md). Every row needs a host action, a persisted result and a user-visible outcome. A visible control or a prefilled composer is UI evidence only.

Scope: one local ADE owner, that owner’s registered projects and installed agents. Team accounts, memberships and separate device identities are out of scope.

Status values: `pass`, `fail`, `unsupported`, `not run`. Record the ADE build, agent and client used for each row.

## Core journeys

| # | Journey | Acceptance case | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Open the workspace | Pending dev-command request in B while working in A; resolve in B; inbox count updates without refresh; closing the assistant returns to prior context. | not run | |
| 2 | Catch up | Seed one completed task, one failed check in a ready session, one interruption and one pending approval; the answer names all four, with links; reading status consumes no destination turn. | not run | |
| 3 | Start work anywhere | Ask from A to start work in B; exactly one turn in B; the returned link opens it; an unavailable model shows the real failure. | not run | |
| 4 | Tidy up | Tidy two projects while a candidate acquires a pending approval; the approval survives; completed list and reopen both update. | not run | |
| 5 | Run frequent workflows | Two manual starts in A, open/cancel composer in B, use the shortcut; A gets exactly one new session; ranking uses 30-day counts with at least two starts. | not run | |
| 6 | Find and add projects | Discover two same-named repositories under different parents; choosing one creates one project; repeating discovery does not duplicate it; cancelling leaves both folders alone. | not run | |
| 7 | Coordinate across projects | Ask Web to check an API change while Web is busy; the reply returns to the origin without reopening Web; stopping the target yields interrupted; retry cannot duplicate work. | not run | |

## Companion behaviors

| Area | Acceptance case | Status | Evidence |
| --- | --- | --- | --- |
| Assistant entry and history | Cmd/Ctrl+J from a project opens the assistant; history search finds older chats by text; Cmd/Ctrl+backslash collapses history; deleting the active thread opens a fresh one; read/unread, stop and confirmed delete work. | not run | |
| Agent, attachments and activity | Pick an installed agent/model; attach a screenshot or file and confirm the agent receives it; open activity during a turn; closing the panel keeps the turn alive; stop ends it; background/unseen indicator is visible. | not run | |
| Inbox | Pinned, pending, failed, unread, active, ready and snoozed groups; project filter; search includes completed/snoozed; just-read selected row stays stable; project-level dev approval opens and resolves; phone actions work in one pane. | not run | |
| Snooze and restore | Presets, exact local date/time and “when work finishes”; resolved wake time visible; undo/change/early return; snoozed list search; wake on expiry, completion, user message or agent decision; timers survive restart; returned row stays unread until opened. | not run | |
| Read versus ask | “How is Web doing?” reads without sending; “Ask Web how it’s going” delivers; origin label appears in the target; up to five destinations with independent outcomes; more-privileged target shows recipient, level and editable draft with send/decline; project questions keep their answer controls. | not run | |
| Project agent handoffs | Child session inherits initiator’s permission ceiling; cross-project send checks apply to project-originated messages; 20-message chain requires the user to continue; replies link both ways; a vanished target returns an individual failure. | not run | |
| Project instructions | Read current instructions, apply a change while preserving other text, reject stale revision, show it in project settings, and deliver the new revision to the next turn of two different adapters plus an existing repository instruction file. | not run | |
| Project identity | Set color, create a simple icon from a description, or use an existing image; navigation, inbox and settings update together; survives reload with two same-named projects. | not run | |
| Voice and feedback | Spoken reply cue on a supported desktop browser; mute works; dictation chime; manual cue; thinking/speaking/awaiting/failed states visible; sound-disabled client and phone suppress speech. | not run | |
| Remote owner access | Host owns history/settings/execution; the token-gated remote client reads the same thread, sends work and receives the result; proxy-authenticated requests stay owner-gated; approvals still happen on the host. | not run | |

## Automated evidence

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | pass (2026-11-17) |
| Workspace backend tests | `node --test src/local/workspace-*.test.mjs src/local/ade-local.turns.test.mjs src/local/remote.test.mjs src/local/adapters/adapters.test.mjs` | pass, 120 tests |
| Turn and remote regressions | included above | pass |
| Production build | `npx vite build` | pass |
| Browser smoke | Playwright at 1440x900 and 390x844 on `/workspace`, `/workspace/inbox`, `/workspace/assistant`, `/workspace/settings`, `/workspace/projects` | pass: no page errors, no horizontal overflow; `/workspace/help` removed |
| Full suite | `npm test` | 661/663; the two failures were browser-integration timing flakes (5s `page.goto`) that pass individually with a desktop Chromium |
