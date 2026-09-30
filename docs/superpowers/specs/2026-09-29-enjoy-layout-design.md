# Enjoy-style layout for ADE — design

**Status:** Approved 2026-09-29
**Reference:** screenshots of enjoy.dev (conversations, files home, file editor, new conversation, agent picker)

## Goal

Restructure ADE's UI to follow Enjoy's layout and navigation: projects as tabs in a top bar, per-project Conversations / Files / Workflows sections, a conversation list beside the thread, a composer with a multi-column agent picker, and a right pane for agent activity.

## Non-goals

- **No restyling.** Keep ADE's current palette, fonts (Bebas Neue, Inter, IBM Plex Mono), utilities (`card-panel`, `label-mono`, `btn-amber`, `btn-quiet`, `btn-ink-ghost`) and components (`StatusPill`, `DiffView`, `ChecksList`, `SessionMessage`). Only change styling where the new layout genuinely requires it.
- No dark theme (later; tokens stay in `src/styles.css` so it can be a token swap).
- No rich (WYSIWYG) Markdown editing.
- No CI/deployment workflows.
- No Claude Code adapter (listed as "Coming later").
- No new safety relaxations: every existing guard (loopback/token checks, dirty-tree baseline, one running task per project, no `--auto`, no Codex sandbox bypass) stays as is.

## Global constraints

- Work lands on `main` as local commits; nothing is pushed (the branch syncs to Lovable).
- Every stage leaves the app working: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass after each task.
- Old URLs keep working through redirects: `/sessions/:sessionId`, `/history`, `/tasks/new`, `/processes`, `/agents`, `/projects/add`.
- CLI flags and commands used by ADE must come from each CLI's own `--help` or official docs (recorded in `docs/superpowers/research/2026-09-29-cli-harness-facts.md`). Never invent a flag; an option a CLI does not support is shown disabled, not faked.
- Commands are always spawned with argument arrays (no shell), matching the existing adapters.

## Stage 1 — Shell and navigation

### Routes

| URL | Content |
| --- | --- |
| `/` | Redirects to `/p/:lastProjectId/conversations`; with no projects shows the existing empty state ("A quieter place to build") |
| `/p/:projectId/conversations` | Conversation list + start screen |
| `/p/:projectId/conversations/:sessionId` | Conversation list + thread |
| `/p/:projectId/files` | Files section (stage 3; placeholder until then) |
| `/p/:projectId/workflows` | Workflows section (stage 4; placeholder until then) |

The route's `projectId` is the source of truth for the active project; `selectProject` is kept in sync from the route. The last visited project id is stored in `localStorage` (`ade-last-project`). Unknown project ids render a "Project not found" state with a link to `/`.

Redirects: `/sessions/:sessionId` → the session's project conversation URL; `/history` → active project conversations with completed shown; `/tasks/new` → active project conversations (start screen); `/processes` → active project conversations with the right pane on Preview; `/agents` → active project conversations with the Agents dialog open; `/projects/add` → the Add project dialog.

### Top bar

Replaces the black header strip, the left projects sidebar and the footer.

- Left: ADE wordmark, then one tab per project (colored initial badge + name; badge color is derived deterministically from the project id from a fixed palette of existing tokens/tints), active tab highlighted, a running-work indicator on tabs with active sessions. Overflow scrolls horizontally.
- "+" tab opens the Add project dialog (existing `projects.add` form + `FolderBrowser`, moved into a dialog component).
- Right: "Projects" dropdown (list/switch all projects, Remove current project with the existing confirmation copy), settings button opening the Agents dialog (existing agents page content, which also shows the "Loopback only · No ADE account · No hosted service" note), and the existing "Local service disconnected" warning.
- Mobile (< `lg`): project tabs collapse into the Projects dropdown; right pane is omitted as today.

### Section tabs

Row under the top bar: Conversations (with a count badge of sessions needing input), Files, Workflows. Links to the routes above.

### Right pane

Tabs: **Activity**, **Preview**, **Editor** (temporary, removed in stage 3), **Terminal** (existing open/close behaviour kept).

- Activity is the portal target (`RightPanePortal`) for route-provided content.
- Preview renders `PreviewPane` for the active project plus the dev-process controls and output that the Processes page shows today (start/stop/open, output tail).
- The existing resizable/collapsible panel behaviour, keyboard shortcuts (⌘\\ sidebar → now the conversation list, ⌘/ right pane, ⌘K new conversation) and persisted layouts stay.

## Stage 2 — Conversations

### Conversation list (left column of the Conversations section)

- Header "Conversations" + new-conversation button.
- Search box (matches request, summary, and message text).
- Filter chips: All, Needs you (`ready` or `blocked`), Working (`working` or `verifying`), Unread. Each chip shows its count.
- Unread: a session whose `updatedAt` is later than the time this browser last viewed it. Last-viewed times are kept in `localStorage` (`ade-session-viewed`: `{ [sessionId]: number }`).
- Card: request (or summary) title, agent short name · date, `StatusPill`; working sessions show elapsed time (mm:ss from the turn start, i.e. latest user message time).
- Footer: count + "Show completed" checkbox (default off; completed sessions hidden unless checked). This replaces the History page.
- Resizable and collapsible like today's sidebar.

### Thread

- Header: request title, `StatusPill`, Stop / Mark complete / Reopen (existing behaviour and copy).
- Messages via `SessionMessage`, blocked/ready notices with the existing failure-kind copy.
- Composer pinned at the bottom (see below). Follow-up semantics are unchanged (queued while a turn runs).

### Start screen (no conversation selected)

"What are you working on?" heading, then the composer. Workflow cards are added in stage 4. Starting creates a session (existing `startTask`) and navigates to its URL. The dirty-tree acknowledgement and "one task running" guard from `tasks/new` move here unchanged. Acceptance criteria stay available as an optional expandable field.

### Composer

Textarea ("Describe a change…" / "Add a follow-up…"), send button, and a footer row: agent chip (agent name + model summary, opens the picker) and the project's current branch (read-only).

### Agent picker

Popover anchored above the composer, columns:

1. **Agent** — every adapter plus Claude Code ("Coming later", disabled). Each row shows status: Ready, Sign in (opens existing `SignInDialog`), Install, or Update (see Harness management). Selecting an agent on an existing session uses the existing switch-agent flow and its disclosure.
2. **Model** — the existing listing from `/api/agents/:id/models` ("Model default" first, "Other model id…" free text). Existing next-turn semantics.
3. **Effort** — values the CLI supports for the selected model; "Model default" first. Disabled with an explanation when the CLI cannot report valid values.
4. **Speed** — shown only as far as a CLI supports it; otherwise "Standard" only, disabled.
5. **Permissions** — Build (default) or Plan, mapped per CLI; Plan is disabled where the CLI has no read-only/plan mode.

Footer: one sentence describing what the selected permission does for that CLI, and a "Close after selection" checkbox (persisted in `localStorage`).

Selections are stored on the session (`model`, `effort`, `speed`, `permission`) and apply from the next turn, like the model today. New fields are optional; missing means the CLI default (flag omitted). The adapter maps them to flags; values are validated server-side against the adapter's declared capabilities.

The per-CLI mapping and capability discovery are specified in `docs/superpowers/research/2026-09-29-cli-harness-facts.md` and summarised in the plan.

### Activity tab

The selected conversation's: context manifest (existing details block), files changed (`DiffView`), checks (`ChecksList` + "Run project checks" with its confirmation), logs. Moved out of the session page's bottom panel.

### Harness management

- Each adapter declares `install`, `update`, and `latestVersion` commands (argument arrays) taken from official docs.
- `GET /api/bootstrap` agents gain `latestVersion?` and `updateAvailable?` (checked in the background, cached like model listings; failure to check is not an error and shows nothing).
- `POST /api/agents/:id/install` and `POST /api/agents/:id/update` start the command as a tracked job; `GET /api/agents/:id/harness` returns `{ status: "idle" | "running" | "succeeded" | "failed", command: string, output: string[], exitCode?: number }`. One job per agent at a time (409 otherwise). Refused while that agent has a running session turn. After success, agent detection and the model cache for that agent are refreshed.
- UI: clicking Install/Update opens a confirmation dialog showing the exact command line; confirming starts it and streams output in the same dialog.
- Loopback-only like the host terminal/editor routes (these run commands on the machine).

## Stage 3 — Files

- `/p/:projectId/files` with its own explorer column (tree from the existing `/api/editor/:id/entries`) and a main area with tabs ("Home" + open files).
- Files home: "Documents" cards for Markdown files in the project (up to 12, most recently modified first, excluding `node_modules`, `.git`, build output) and a "Project files" list of the root directory.
- Opening a file uses the existing `HostEditorPane` editor internals. Markdown files get a Document / Source toggle: Document renders with `react-markdown` (read-only), Source is the editable text with the existing save/version conflict handling.
- The Editor tab is removed from the right pane.

## Stage 4 — Workflows

- A workflow: `{ id, name, description, prompt, agentId?, permission?, builtIn?: boolean }`, stored in `~/.ade/workspace.json` under `workflows` (built-ins are defined in code and not persisted).
- Built-ins: Design workshop, Explain this codebase, Plan the next feature (prompt text in the plan).
- Start screen shows up to three workflow cards plus "Browse all workflows" and "New workflow". Clicking a card fills the composer with the prompt (and applies its agent/permission if set); it does not auto-send.
- `/p/:projectId/workflows` lists workflows with create / edit / delete (built-ins can be duplicated, not edited or deleted).
- API: `GET /api/workflows`, `POST /api/workflows`, `POST /api/workflows/:id`, `POST /api/workflows/:id/delete`.

## Testing

- Unit tests (`node --test`) for new local-service logic: adapter flag mapping for effort/speed/permission, capability validation, harness job lifecycle (with a fake runner), workflows persistence.
- Route redirects and UI verified in the browser against the reference screenshots at each stage.
- `npm run typecheck && npm run lint && npm test && npm run build` after every task.
