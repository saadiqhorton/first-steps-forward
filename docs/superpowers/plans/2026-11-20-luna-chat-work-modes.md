# Luna chat and work modes — implementation plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Luna chat an explicit mode, an explicit folder under `~/.ade`, and a permission that is applied and persisted, without changing project-approval behavior.

**Architecture:** `mode` and `permission` live on the assistant thread. Chat runs in a shared `~/.ade/luna` root; Work runs in `~/.ade/luna/<threadId>`, created lazily. Both `io.spawn` and `projectPath` use the mode folder. A short code-owned brief is prepended when the agent session is new or the mode changed. Project handoffs stay capped at `plan`.

**Tech Stack:** Node local service (`src/local/`), node:test, React (`src/components/ade/`), existing `AgentPicker` and `SegmentedControl`.

**Spec:** `docs/superpowers/specs/2026-11-20-luna-chat-work-modes-design.md`

## Global constraints

- No new dependencies.
- `workspacePath` is never accepted from the client. The service derives it from `dataDir` and the thread id.
- Change cwd in **both** places in `run()`: `io.spawn` and `projectPath`. Codex `exec resume` carries no `--cd`.
- `describeSource()` in `workspace-handoffs.mjs` stays `permission: "plan"`. Do not raise it from the thread's Work permission.
- Do not add deliverable generation, web tools, or a folder picker.
- UI uses existing tokens only; `npm run token-audit` must stay at zero.
- Tests that touch the service use a temp `dataDir`; never live `~/.ade`.
- Claim-done checks: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. Focused `node --test <files>` while iterating.
- Do not commit unless the human asks.

---

## File map

- Create: `src/local/luna-brief.mjs` — the mode brief text
- Create: `src/local/luna-brief.test.mjs`
- Modify: `src/local/workspace-assistant.mjs` — fields, folders, spawn seam, brief, delete
- Modify: `src/local/workspace-assistant.test.mjs`
- Modify: `src/local/routes/workspaceAssistant.mjs` — PATCH allowlist, capability gate
- Modify: `src/local/workspace-assistant.routes.test.mjs`
- Modify: `src/lib/ade/workspaceApi.ts` — thread and payload types
- Modify: `src/components/ade/AgentPicker.tsx` — chip permission segment
- Modify: `src/components/ade/WorkspaceChat.tsx` — mode control, permission wiring
- Modify: `design/components/composer.md`
- Reference: `src/local/capabilities.mjs` (`validateOptions` already validates permission)
- Reference: `src/local/agent-status.mjs` (`resolveSessionOptions`)

---

### Task 1: Luna brief module

**Files:**
- Create: `src/local/luna-brief.mjs`
- Create: `src/local/luna-brief.test.mjs`

**Interfaces:**
- Produces: `lunaBrief({ mode, folder }) → string`

- [ ] **Step 1: Write the module**

```js
/**
 * The brief prepended to a Luna turn. Code-owned on purpose: behavior must not
 * depend on which CLI agent is selected or on a file that CLI may or may not read.
 */
export function lunaBrief({ mode, folder }) {
  const lines = [
    "You are Luna, the assistant inside ADE.",
    mode === "work"
      ? `You may create and edit files in this folder only: ${folder}`
      : "This chat is read-only. Answer and help; do not change files.",
    "Never read or change folders outside that one.",
    "Project changes in ADE go through the owner's approval, not by editing project files directly.",
    "Report failures and unavailable capabilities as they are.",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 2: Test it**

`src/local/luna-brief.test.mjs`: asserts the work text contains the folder path, the chat text does not, and both mention the folder boundary and approval.

- [ ] **Step 3: Run**

```sh
node --test src/local/luna-brief.test.mjs
```

---

### Task 2: Service — thread fields, folders, spawn seam, brief

**Files:**
- Modify: `src/local/workspace-assistant.mjs`

**Interfaces:**
- Consumes: `lunaBrief` from Task 1, `spawnCommand` from `./spawn.mjs`
- Produces: `createWorkspaceAssistant({ ..., spawn = spawnCommand })`; thread fields `mode`, `permission`, `workspacePath`, `briefedMode`

- [ ] **Step 1: Add the spawn seam**

In `createWorkspaceAssistant`'s options add `spawn = spawnCommand`. In `run()`'s `io.spawn`, call `spawn(bin, args, { cwd, env, stdio, shell })` instead of `spawnCommand`. This exists so tests can observe the turn's cwd without launching a process.

- [ ] **Step 2: Add folder helpers**

```js
import { promises as fsp } from "node:fs";
import path from "node:path";

const lunaRoot = () => path.join(dataDir, "luna");
const ensureLunaRoot = async () => {
  await fsp.mkdir(lunaRoot(), { recursive: true, mode: 0o700 });
  return lunaRoot();
};
const ensureWorkFolder = async (thread) => {
  const folder = path.join(lunaRoot(), thread.id);
  await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
};
/** Chat turns share the Luna root. Work turns get their own folder. */
const turnFolder = (thread) =>
  thread.mode === "work" ? ensureWorkFolder(thread) : ensureLunaRoot();
```

- [ ] **Step 3: Add fields in `startThread`**

Generate the id before the object, then:

```js
const threadId = id();
const thread = {
  id: threadId,
  // …existing fields…
  mode: input.mode === "work" ? "work" : "chat",
  permission: input.permission ?? "plan",
  workspacePath: path.join(dataDir, "luna", threadId),
};
```

If `input.mode === "work"` and no `input.permission`, use `"build"`. Validate any explicit permission through `resolveSessionOptions` alongside the existing `model`/`effort` call:

```js
const option = await resolveSessionOptions(agentId, input.model, {
  effort: input.effort,
  permission: input.permission,
});
```

Do **not** create the folder here.

- [ ] **Step 4: Use the folder and permission in `run()`**

```js
const cwd = await turnFolder(thread);
const needsBrief = !thread.agentSessionId || thread.briefedMode !== thread.mode;
const brief = needsBrief ? `${lunaBrief({ mode: thread.mode, folder: cwd })}\n\n` : "";
if (needsBrief) thread.briefedMode = thread.mode;
```

- `io.spawn(...)` → `cwd`
- `projectPath: cwd`
- `permission: thread.permission ?? "plan"`
- `prompt: `${brief}${userMessage}${formatAttachmentPrompt(files)}``

- [ ] **Step 5: Extend `updateThread`**

Accept `mode` and `permission`, keep them consistent, and validate:

```js
if (input.mode !== undefined) {
  if (input.mode !== "chat" && input.mode !== "work")
    throw Object.assign(new Error("Choose chat or work."), { status: 400 });
  thread.mode = input.mode;
  if (input.mode === "chat") thread.permission = "plan";
  else if ((thread.permission ?? "plan") === "plan") thread.permission = "build";
}
if (input.permission !== undefined) {
  thread.permission = input.permission;
  thread.mode = input.permission === "plan" ? "chat" : "work";
}
// then the existing resolveSessionOptions call, now passing permission:
const checked = await resolveSessionOptions(thread.agentId, nextModel, {
  effort: input.effort !== undefined ? input.effort : thread.effort,
  permission: thread.permission,
});
```

Store `checked.value?.permission ?? thread.permission` when a permission was supplied. Leave `briefedMode` untouched so a mode change re-briefs.

On `agentId` change, also reset `permission` to `"plan"` and `mode` to `"chat"` before validating, the same way `model`/`effort` are currently reset. Otherwise a permission from the previous adapter follows the thread into an adapter that does not offer it.

- [ ] **Step 6: Delete the Work folder in `deleteThread`**

```js
const root = lunaRoot();
const target = path.join(root, threadId);
const rel = path.relative(root, target);
if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
  const stat = await fsp.lstat(target).catch(() => null);
  if (stat?.isDirectory() && !stat.isSymbolicLink())
    await fsp.rm(target, { recursive: true, force: true });
}
```

Keep this before `onDeleteThread`, and never remove `lunaRoot()` itself.

---

### Task 3: Service tests

**Files:**
- Modify: `src/local/workspace-assistant.test.mjs`

Use a temp `dataDir` from `mkdtempSync(os.tmpdir())` and `rmSync` in cleanup.

- [ ] **Step 1: cwd for both surfaces**

Fake adapter captures `input.projectPath` and calls `io.spawn("fake", [], {})`. Fake `spawn` records `options.cwd` and returns `{ kill() {} }`. Assert both equal `path.join(dataDir, "luna")` in Chat.

- [ ] **Step 2: Work folder**

Start with `mode: "work"`, permission `"build"`, `resolveSessionOptions` returning `{ ok: true, value: { permission: "build" } }`. Assert cwd is `path.join(dataDir, "luna", thread.id)` and both `luna/` and the thread folder exist after the turn.

- [ ] **Step 3: Lazy creation**

Chat turn leaves `luna/` present and `luna/<id>` absent.

- [ ] **Step 4: Continuing turn**

Fake adapter emits `{ type: "conversation", id: "agent-session" }`. A follow-up asserts the same folder is used.

- [ ] **Step 5: Brief behavior**

Capture `input.prompt`. First turn contains `You are Luna`. A same-mode follow-up does not. After `updateThread({ mode: "work" })`, the next prompt contains it again.

- [ ] **Step 6: Old threads**

Insert a thread without `mode`/`permission`/`workspacePath` directly into `state.assistantThreads`; assert it runs in `luna/` with `plan`.

- [ ] **Step 7: Delete guard**

Create `luna/<threadId>`, a sibling `luna/keep`, and a symlink `luna/<other>` pointing outside. Delete the thread; assert only its own real folder is gone and the outside target survives.

- [ ] **Step 8: Permission validation**

`resolveSessionOptions` returns `{ ok: false, error: 'permission "full" is not available…' }`; assert PATCH-style update rejects with that message.

- [ ] **Step 9: Run**

```sh
node --test src/local/workspace-assistant.test.mjs
```

---

### Task 4: Routes

**Files:**
- Modify: `src/local/routes/workspaceAssistant.mjs`
- Modify: `src/local/workspace-assistant.routes.test.mjs`

- [ ] **Step 1: PATCH allowlist**

Include `data.mode` and `data.permission` in the condition that dispatches to `updateThread`:

```js
if (
  data.agentId !== undefined ||
  data.model !== undefined ||
  data.effort !== undefined ||
  data.mode !== undefined ||
  data.permission !== undefined
)
  return json(res, 200, await assistant.updateThread(threadId, data));
```

- [ ] **Step 2: Capability gate**

Before that dispatch, when `mode` or `permission` is present:

```js
if (!can("approve"))
  return json(res, 403, { error: "Only the host owner can change how Luna works." });
```

In `POST /threads`, after the existing `can("start")` check, reject `mode: "work"` or a non-`plan` permission without `can("approve")`.

- [ ] **Step 3: Route tests**

Extend the `context()` helper to accept extra `ctx` fields (for `devicePolicy` and `deviceContext`).

- PATCH `{ permission: "build" }` reaches `updateThread`.
- `devicePolicy: (_ctx, capability) => capability !== "approve"` yields 403 for PATCH mode/permission and for `POST` with `mode: "work"`.
- A PATCH carrying `workspacePath` still reaches `updateThread` only for the allowed fields; assert the stored thread has no client-supplied path (the service ignores it).

- [ ] **Step 4: Run**

```sh
node --test src/local/workspace-assistant.routes.test.mjs
```

---

### Task 5: Client types

**Files:**
- Modify: `src/lib/ade/workspaceApi.ts`

- [ ] **Step 1: Thread shape**

Add to `AssistantThread`: `mode?: "chat" | "work"`, `permission?: string`, `workspacePath?: string`.

- [ ] **Step 2: Payloads**

`startAssistantThread` and `patchAssistantThread` accept `mode?: "chat" | "work"` and `permission?: string`. Do **not** add `workspacePath` to either.

- [ ] **Step 3: Run**

```sh
npm run typecheck
```

---

### Task 6: UI

**Files:**
- Modify: `src/components/ade/AgentPicker.tsx`
- Modify: `src/components/ade/WorkspaceChat.tsx`

- [ ] **Step 1: Export a permission label helper**

In `AgentPicker.tsx`, export `permissionShort(id)` with a small map (`plan: "Read-only"`, `build: "Ask"`, `approve: "Auto-approve"`, `full: "Full access"`, `manual: "Manual"`, `auto: "Auto"`, `"dont-ask": "Don't ask"`, `bypass: "Bypass"`). Reuse the existing `permissionLabels` where available.

- [ ] **Step 2: Chip shows Work**

Change `agentChipLabel` to append the permission when it is not `"plan"`:

```ts
const permissionPart = sel.permission && sel.permission !== "plan"
  ? ` · ${permissionShort(sel.permission)}`
  : "";
return { title, subtitle: `${modelPart} · ${effortPart}${permissionPart}` };
```

- [ ] **Step 3: Read the thread's permission**

In `WorkspaceChat.tsx`, replace the literal `permission: "plan"` in `activeSelection` with `thread?.permission ?? "plan"`.

- [ ] **Step 4: Mode control**

Query the active agent's capabilities with the existing client helper:

```ts
const caps = useQuery({
  queryKey: ["agent-caps", activeSelection.agentId, activeSelection.model],
  queryFn: () => optionCapabilities(activeSelection.agentId, activeSelection.model || undefined),
  enabled: !!activeSelection.agentId,
});
```

Render `SegmentedControl` with options `[{ value: "chat", label: "Chat" }, { value: "work", label: "Work" }]` above the composer. Value is `activeSelection.permission === "plan" ? "chat" : "work"`. `onValueChange` sends a PATCH (existing thread) or updates selection (new thread) with `permission: "plan"` or the first non-plan permission from `caps.data?.permissions`.

Disable Work when `caps.data?.permissions` has no non-plan entry, with a `title` from `caps.data?.permissionNotes` (OpenCode's note is the relevant one). Add `aria-label="Luna mode"`.

- [ ] **Step 5: Send the permission**

`send()` for a new thread includes `...(activeSelection.permission ? { permission: activeSelection.permission } : {})`. `newChat()` does the same.

- [ ] **Step 6: Patch only when permission changed**

In `onSelectionChange`, compare with the thread's stored permission and include `permission` in the PATCH only when it differs. Agent changes must not carry a stale permission from the previous adapter; Task 2 resets it server-side.

- [ ] **Step 7: Run**

```sh
npm run typecheck
npm run token-audit
```

---

### Task 7: Docs

**Files:**
- Modify: `design/components/composer.md`

- [ ] **Step 1: Record the chip change**

In §3/§5, note that the agent chip's subtitle includes the permission when it is not `plan`. Add a cross-reference to `design/components/segmented-control.md` for Luna's Chat/Work control.
- [ ] **Step 2: No new component doc**

The mode control reuses `SegmentedControl`; do not add a component page.

---

### Task 8: Full checks

- [ ] **Step 1: Run the contract**

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run token-audit
```

- [ ] **Step 2: Verify the never-list**

Confirm no test or script writes outside its temp `dataDir`; confirm nothing reads live `~/.ade`; confirm `describeSource` is unchanged.

- [ ] **Step 3: Report**

State what was verified: cwd on both surfaces, continuing turns, lazy folder creation, brief timing, delete guard, route capability, chip text, token audit.

---

## Self-review (plan author)

1. **Spec coverage:** thread fields, mode/permission consistency, folder rules, brief, routes, UI, tests, and out-of-scope items all map to a task.
2. **Placeholder scan:** no TBD or non-English text; every task names exact files and assertions.
3. **Consistency:** permission validation reuses `resolveSessionOptions`; `workspacePath` is service-derived; handoff ceiling untouched.
