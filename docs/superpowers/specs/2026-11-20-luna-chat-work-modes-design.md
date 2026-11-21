# Luna chat and work modes

Date: 2026-11-20
Status: decisions locked in conversation; awaiting file review before an implementation plan

## Goal

Let Luna be a general assistant you can ask anything, without losing the project
awareness it already has. Today every Luna turn is read-only and runs in whatever
directory ADE happened to be launched from. After this change a Luna chat has an
explicit mode, an explicit folder, and a permission setting that is actually
applied and persisted.

This is the Chat/Work split: Chat answers; Work can change files in its own folder.
Project work still goes through owner approval.

## Locked decisions

- **Read-only ADE awareness in both modes.** Luna keeps the read tools
  (`workspace_list_projects`, `workspace_search_sessions`, `workspace_read_session`,
  `workspace_project_settings`, `workspace_list_handoffs`). Project mutations keep
  their existing approval handoff.
- **Luna's work lives under `~/.ade`**, not in a project and not in
  `process.cwd()`.
- **Folder creation is lazy.** Chat never creates a per-chat folder.
- **The mode brief is code-owned**, prepended to the prompt, so behavior does not
  depend on which CLI agent is selected.
- **Reuse existing UI components.** Agent/model/effort/speed/permission stay in
  `AgentPicker`; the mode control is `SegmentedControl`. No new picker.
- **Documents and decks are out of scope.** Deliverable generation is a later
  spec.

## What the code does today (verified)

- `workspace-assistant.mjs` `run()` passes `permission: "plan"` (~196) and sets cwd
  in two places: `io.spawn({ cwd: process.cwd() })` (~188) and
  `projectPath: process.cwd()` (~210).
- CLI adapters spawn through `io.spawn` (`kit.mjs:191`); ACP adapters use
  `projectPath` as `session/new` cwd (`kit.mjs:331`). Codex passes `--cd projectPath`
  on a new session only; `exec resume` does not.
- `startThread()` stores `agentId`, `model`, `effort`, `dataDir`; no mode, no folder,
  no permission. `updateThread()` accepts agent/model/effort only.
- The PATCH route forwards `agentId/model/effort` to the service and silently
  returns the unchanged thread for any other field (~98).
- `callTool()` checks thread and token only; it is not permission-gated.
- `describeSource()` returns `permission: "plan"` for any assistant thread
  (`workspace-handoffs.mjs:23`), which is what forces owner approval on Luna's
  project requests.
- `deleteThread()` removes state and cancels handoffs; it deletes no files.
- `agentChipLabel()` returns agent, model and effort. Permission is not shown on the
  closed chip.
- `resolveSessionOptions()` already validates `permission` against the adapter's
  list (`capabilities.mjs:59`), so the service side of validation exists.
- Permission lists: Codex `plan/build/approve/full`; Claude
  `manual/build/plan/auto/dont-ask/bypass`; OpenCode and Pi fall back to
  `build/plan`. OpenCode's non-interactive run auto-rejects permission requests
  (`opencode.agent.mjs:291`).
- Codex is always given `--skip-git-repo-check`, so a non-git folder under `~/.ade`
  is usable.

## Design

### Thread fields

```ts
mode: "chat" | "work";          // user intent
permission: string;             // effective turn setting, validated per agent/model
workspacePath: string;          // ~/.ade/luna/<threadId>, only created for Work
briefedMode?: "chat" | "work";  // last mode described to the agent session
```

Reads default missing fields: `mode: "chat"`, `permission: "plan"`,
`workspacePath` computed from `dataDir` and the thread id. Persisted on the next
save; no separate migration.

### Mode and permission stay consistent

`mode` is the user's intent; `permission` is what the adapter receives. They are
kept from disagreeing:

- Switching to Work sets `permission` to `"build"` only when the current value is
  `"plan"`. An explicit choice such as Codex `approve` survives a mode round-trip.
- Switching to Chat sets `permission` to `"plan"`.
- Choosing a non-read-only permission in `AgentPicker` sets `mode: "work"`;
  choosing `plan` sets `mode: "chat"`.
- Work is disabled, with the adapter's reason shown, when the selected agent/model
  offers no writable permission. OpenCode gets an explicit note that its
  non-interactive runs auto-reject permission requests.

### Folders

```
~/.ade/luna/                 shared Luna root, created on the first Luna turn
~/.ade/luna/<threadId>/      one Work chat's folder, created on its first Work turn
```

- **Chat cwd is `~/.ade/luna`**, the shared root. It must not be `~/.ade` itself:
  Codex plan mode can read its cwd, and `~/.ade` holds live application data.
- **Work cwd is `~/.ade/luna/<threadId>`**, created just before the first turn that
  needs it. Chat users never accumulate empty per-chat directories.
- Both `io.spawn` and `projectPath` use the mode's folder. Changing only one breaks
  continuing Codex turns, because `exec resume` carries no `--cd`.
- `workspacePath` is never accepted from the client in this pass. The service
  derives it from `dataDir` and the thread id, so no request can point a turn at an
  arbitrary directory.
- Deleting a thread removes `~/.ade/luna/<threadId>` after checking the resolved
  path is inside `~/.ade/luna` and is not a symlink.

### Luna brief

A short code-owned preamble (target ~120 words) prepended to the user prompt when
the agent session is new or when `mode` differs from `briefedMode`. It states:

- You are Luna, the assistant inside ADE.
- The current folder, and that it is the only folder you may change.
- Chat is read-only; Work may create and edit files in that folder.
- Project changes go through ADE's handoff and the owner's approval.
- Report failures and unavailable capabilities as they are.

It is not written to disk and is not editable in this pass, so the brief cannot
drift per installation. `~/.ade/luna/AGENTS.md` is deliberately not used: whether a
CLI loads it is CLI behavior, and a shared file would apply to every chat at once.

### Service changes (`src/local/workspace-assistant.mjs`)

- `startThread`: derive `workspacePath` after the thread id exists; default
  `mode: "chat"`, `permission: "plan"`; validate an explicit permission through
  `resolveSessionOptions`.
- `run`: resolve the mode folder, create the Work folder lazily, use it for both
  `io.spawn` and `projectPath`, pass `thread.permission`, and prepend the brief.
- `updateThread`: accept `mode` and `permission`; validate through the existing
  `resolveSessionOptions` call; store `briefedMode` untouched so a mode change
  re-briefs the session.
- `deleteThread`: remove the Work folder behind the path guard.
- `describeSource` in `workspace-handoffs.mjs` stays `permission: "plan"`. Raising
  it from a thread's Work permission would remove the owner-approval step for
  starting project sessions. That is a separate, explicit decision.

### API changes (`src/local/routes/workspaceAssistant.mjs`)

- PATCH dispatches to `updateThread` when `mode` or `permission` is present. Today a
  permission-only PATCH is silently ignored.
- Changing mode or permission requires the `approve` capability, not just
  `message`: it grants write access on the host. `POST /threads` with
  `mode: "work"` requires `approve` for the same reason.
- No new route and no `workspacePath` input.

### UI changes

- `WorkspaceChat.tsx`: `SegmentedControl` (Chat | Work) above the composer; Work
  disabled with a reason when unsupported. Selection reads `permission` from the
  thread instead of the literal `"plan"`.
- `AgentPicker.tsx` / `agentChipLabel`: include a non-plan permission in the chip
  subtitle so Work is visible when the picker is closed.
- `design/components/composer.md`: note the chip's permission segment.
- Tokens only; no raw values. `npm run token-audit` must stay at zero.

## Tests

Service (`src/local/workspace-assistant.test.mjs`)

- Chat turn: `io.spawn` cwd and `projectPath` both equal `~/.ade/luna`; permission
  is `plan`.
- Work turn: both equal `~/.ade/luna/<threadId>`; permission is the stored value.
- A continuing turn (`agentSessionId` set) uses the same folder as the first turn.
- The Work folder is absent after Chat turns and exists after the first Work turn.
- The brief is prepended on a new session and after a mode change, and not repeated
  on an unchanged follow-up.
- Old threads without the new fields load as Chat and still run.
- `deleteThread` removes only the thread folder; a sibling folder and the Luna root
  survive; a symlinked path is refused.
- Unsupported permission is rejected with the adapter's message.

Routes (`src/local/workspace-assistant.routes.test.mjs`)

- PATCH `permission` and `mode` reach `updateThread`.
- A device without `approve` gets 403 for mode or permission changes, and for
  starting a Work thread.
- A request carrying `workspacePath` does not influence the stored path.

All of the above run with `HOME`/`USERPROFILE` remapped to a temp directory; no test
touches live `~/.ade`.

## Out of scope

- Documents, spreadsheets and decks.
- Web research tools.
- A folder picker or a configurable Luna root.
- Per-mode default agent/model (`state.assistantDefaults` is read but never written;
  wiring it needs its own settings surface).
- Changing the handoff permission ceiling.
- A cross-device mode filter in the history list.

## Risks

- **OpenCode Work chats are limited.** Its non-interactive CLI has no approval
  channel; actions needing permission are rejected. The mode control must say so
  rather than fail mid-turn.
- **`~/.ade` is on the never-touch list for agents and tests.** The runtime feature
  writes there by design, so `dataDir` stays a parameter and every test remaps
  `HOME`.
- **Folder growth.** Work folders persist until the chat is deleted; no size cap in
  this pass.
- **Brief repetition.** Prepend-on-new-session keeps context cost near zero but
  means a re-briefed session carries the old brief in its history too. Acceptable;
  worth watching if mode flips often.
