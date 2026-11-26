# ADE responsiveness — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ADE from doing heavy work for panes the user is not looking at, matching the patterns verified against t3code, Synara, Paseo, Orca, OpenHands, OpenCode, and Goose.

**Architecture:** Keep ADE’s one-process, per-turn CLI model. Gate the JPEG screencast, full `git diff`, activity reformat, and terminal long-poll on real visibility. Do not keep agent CLIs warm. A transcript virtualizer is a separate later task because it needs a new dependency and does not fix idle cost.

**Tech Stack:** Existing ADE local service (`src/local/`), React ADE UI (`src/components/ade/`), `node:test`, existing Playwright component fixtures. No new dependencies in Tasks 1–4.

**Evidence:** Explorer + independent verifier notes under `research_notes/Fast agent desktop patterns/` (`explore-*.md`, `verify-*.md`). Report: `reports/Fast agent desktop patterns.md`.

## Global Constraints

- Do not start a second ADE on port 3100. Tests that import `ade-local` must set `HOME` and `USERPROFILE` to a temp directory.
- Do not touch live `~/.ade`, other registered projects, or kill a running ADE the human is using.
- Do not adopt t3code `DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000` or Synara’s 30-minute provider reaper. Those keep agent CLIs warm. ADE clears `slot.child` when the turn returns.
- Do not add a detached PTY worker in this plan. Idle PTY reads already yield; the terminal bug is the hidden long-poll.
- Do not add single-flight around `refreshBootstrapInBackground`. `refreshingBootstrap` already drops overlapping ticks.
- Do not disable `useSessionLogs` or drop `logs:` SSE when the activity column is hidden. The transcript status line and computer line count still need that query.
- Do not treat `SessionThread`’s 40-row window as a data window. `GET /api/sessions/:id` already returns every message.
- UI tokens only; `npm run token-audit` must stay clean for any CSS/TSX change.
- Claim-done checks for the batch: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. Focused `node --test <files>` while iterating.
- Do not commit unless the human asks.

---

## File map

- Modify: `src/components/ade/browser/BrowserPreviewProvider.tsx` — docked canvas counts as a viewer only while `visible`
- Modify: `src/components/ade/AgentComputerPane.tsx` — already sets `setVisible(active)`; verify only
- Test: extend `src/local/browser-preview.integration.test.mjs` or add a focused UI/integration assertion for stream wanted
- Modify: `src/components/ade/HostTerminalPane.tsx` — stop long-poll when `visible` is false
- Test: add terminal idle/visibility coverage under `src/local/` or component integration
- Modify: `src/components/ade/ActivityLogs.tsx` — freeze format while the column has no box
- Test: activity hidden-column fixture (new `*.integration.test.mjs` next to session-thread)
- Modify: `src/local/events.mjs` — track diff-watch project ids (refcount)
- Modify: `src/local/routes/events.mjs` — `POST` interest for diff watch
- Modify: `src/local/ade-local.mjs` — `getDiff` only for watched projects on the 10s tick
- Modify: `src/components/ade/SessionView.tsx` — register/unregister diff watch from `rightTab`
- Modify: `src/lib/ade/store.tsx` or a tiny helper — client call for the interest POST
- Test: `src/local/events.test.mjs`, plus a bootstrap-refresh unit/integration around `getDiff` gating
- Later (Task 5, optional follow-on): `SessionThread.tsx`, `WorkspaceChat.tsx`, `@tanstack/react-virtual`

---

### Task 1: Stop the screencast when the Browser tab is not shown

**Files:**
- Modify: `src/components/ade/browser/BrowserPreviewProvider.tsx` (around the `wanted` predicate, currently ~311–313)
- Reference: `src/components/ade/AgentComputerPane.tsx` (already calls `setPlacementVisible(active)` at ~72–76)
- Reference: `src/components/ade/browser/BrowserPresentationProvider.tsx` (`visible` / `setVisible`)
- Test: `src/local/browser-preview.integration.test.mjs` or a new focused test that the stream URL is null when docked and not visible

**Interfaces:**
- Consumes: `useBrowserPlacement().visible`, `place`, `canvas`, `capture.recording`, `resting`
- Produces: `wanted === true` for a docked surface only when `visible` is true (float and recording unchanged)

Upstream match: t3code `DesktopBrowserChannel.isShown` — a preview that is not on screen is not a viewer. Chrome stays up; only the JPEG loop must stop so `viewerCount` can hit 0 and the existing 60s rest / 15min close can run.

- [ ] **Step 1: Write a failing assertion**

Add a unit-style test of the wanted rule (extract a tiny pure helper if that keeps the test out of React):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { streamWanted } from "../../src/components/ade/browser/streamWanted.mjs";

test("a docked canvas that is not visible does not want the stream", () => {
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "dock",
      canvas: {},
      visible: false,
      recording: false,
    }),
    false,
  );
});

test("float and recording still want the stream when docked canvas is hidden", () => {
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "float",
      canvas: null,
      visible: false,
      recording: false,
    }),
    true,
  );
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "dock",
      canvas: null,
      visible: false,
      recording: true,
    }),
    true,
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test src/components/ade/browser/streamWanted.test.mjs`  
Expected: FAIL (module missing) or FAIL on the docked+hidden case if the helper still mirrors the old predicate.

- [ ] **Step 3: Implement the helper and wire it**

Create `src/components/ade/browser/streamWanted.mjs`:

```js
/** Whether the preview WebSocket should be open. */
export function streamWanted({ projectId, resting, place, canvas, visible, recording }) {
  if (projectId == null || resting) return false;
  if (place === "float" || recording) return true;
  return canvas != null && visible;
}
```

In `BrowserPreviewProvider.tsx` replace the inline `wanted` with:

```tsx
const wanted = streamWanted({
  projectId,
  resting,
  place,
  canvas,
  visible,
  recording: capture.recording,
});
```

Keep the comment: the stream runs while a surface is painting; a CSS-hidden docked canvas is not painting.

- [ ] **Step 4: Re-run the test**

Run: `node --test src/components/ade/browser/streamWanted.test.mjs`  
Expected: PASS

- [ ] **Step 5: Manual check against the shell contract**

Confirm `AgentComputerPane` still runs `setPlacementVisible(active)` and that Shell passes `active={rightTab === "computer"}`. No change needed if that is already true. Collapsing the right rail with the computer tab selected should still set `active` false via the existing shell wiring; if it does not, fix Shell so collapsed means not active for computer (same as Processes already gates on `active`).

- [ ] **Step 6: Commit only if the human asks**

```bash
git add src/components/ade/browser/streamWanted.mjs \
  src/components/ade/browser/streamWanted.test.mjs \
  src/components/ade/browser/BrowserPreviewProvider.tsx
# git commit only when asked
```

---

### Task 2: Stop the terminal long-poll when the pane is hidden

**Files:**
- Modify: `src/components/ade/HostTerminalPane.tsx` (poll `useEffect` ~163–261; `visible` currently only refits ~293–300)
- Reference: `src/local/terminal.mjs` (`IDLE_MS` 2 minutes, `snapshotTerminal` refreshes `lastSeen`)
- Reference: `src/components/ade/Shell.tsx` (`terminalOpened` keeps the pane mounted under `hidden`)
- Test: new `src/components/ade/host-terminal-visibility.integration.test.mjs` or a `terminal.mjs` test that proves no poll ⇒ reap after idle

**Interfaces:**
- Consumes: `visible: boolean`
- Produces: no `GET /api/terminal/:id?wait=1000` while `visible` is false; after 2 minutes without `lastSeen` refresh, server `closeTerminal` runs

Do not destroy the PTY on every tab switch. Only stop the poll so the existing sweeper can reap. Re-opening the tab starts a new poll on the same session if it still exists, or creates a new one if it was reaped.

- [ ] **Step 1: Write the failing visibility contract**

Prefer a pure helper for the poll decision, then an integration check:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { shouldPollTerminal } from "../../src/components/ade/shouldPollTerminal.mjs";

test("hidden pane does not poll", () => {
  assert.equal(shouldPollTerminal({ visible: false, status: "connected" }), false);
});

test("visible connected pane polls", () => {
  assert.equal(shouldPollTerminal({ visible: true, status: "connected" }), true);
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `node --test src/components/ade/shouldPollTerminal.test.mjs`  
Expected: FAIL (missing module)

- [ ] **Step 3: Gate the poll effect on `visible`**

```js
export function shouldPollTerminal({ visible, status }) {
  return visible && status !== "exited" && status !== "error";
}
```

In `HostTerminalPane.tsx`, split “open session once” from “poll while visible”:

1. Keep creating the PTY when the pane first mounts (`terminalOpened`).
2. Start the `wait=1000` loop only while `shouldPollTerminal({ visible, status })` is true.
3. When `visible` becomes false, abort the in-flight poll (`pollAbort.abort()` / clear `pollTimer`) without calling `/close`.
4. When `visible` becomes true again, resume polling the same `currentId` if the session still exists; if the server returns gone, show reconnect/create as today.

The fit/focus effect that already depends on `visible` stays.

- [ ] **Step 4: Prove the 2-minute reap can fire**

Add a `terminal.mjs` test (HOME remapped) that: creates a session, never calls `snapshotTerminal` / read for > `IDLE_MS`, runs the sweeper (or advances time if the module exposes a test hook), asserts the session is gone. If the sweeper is only a module `setInterval`, export a `reapIdleTerminals(now)` for tests rather than waiting two real minutes.

- [ ] **Step 5: Run focused tests**

Run: `node --test src/components/ade/shouldPollTerminal.test.mjs src/local/terminal*.test.mjs`  
Expected: PASS

---

### Task 3: Freeze activity formatting while the column has no box

**Files:**
- Modify: `src/components/ade/ActivityLogs.tsx`
- Reference: `src/components/ade/SessionView.tsx` (activity wrapper `hidden` when `rightTab !== "activity"`)
- Reference: `src/lib/ade/formatLogs.mjs` (`formatSessionLogs`)
- Do not modify: `src/local/events.mjs` log coalescing, `useSessionLogs`, `SessionThread`
- Test: new `src/components/ade/activity-logs-visibility.integration.test.mjs`

**Interfaces:**
- Consumes: root element client rects (`getClientRects().length > 0`), same test `TurnBlock` already uses
- Produces: while no box, last `formatSessionLogs` / `groupActivityTurns` result and the same React element tree; on first box, one format of the latest lines

- [ ] **Step 1: Write the failing hidden-column test**

Follow the explorer’s contract:

1. Render `ActivityLogs` under a parent with class `hidden`.
2. Record row text / node identities.
3. Append lines that would create a new title.
4. Assert the hidden tree’s text and row identities stay put.
5. Remove `hidden`; assert the new title appears and a pre-gap turn id is the same node (`lineOffset` survived).

Also assert: with the column hidden, a parent that still calls `currentActivity(session.logs)` updates the status sentence (regression against “fix” by disabling the logs query).

- [ ] **Step 2: Run and confirm fail**

Run the new integration test the same way `session-thread.integration.test.mjs` is run in this repo.  
Expected: FAIL because format still runs under `hidden`.

- [ ] **Step 3: Gate format on a box**

In `ActivityLogs.tsx`:

1. Put a ref on the root.
2. `useLayoutEffect` + `ResizeObserver`: `shown = root.getClientRects().length > 0`.
3. While `!shown`, reuse the previous `rows` / turn tree (do not call `formatSessionLogs` on the new `lines`).
4. When `shown` flips true, format the latest `lines` once.
5. Default “shown” for first paint when rects already exist (assistant drawer). A drawer that is open must keep formatting; the gate is the element’s box, not `rightTab`.

Leave `recordLog`, SSE, and `useSessionLogs` alone.

- [ ] **Step 4: Run focused tests**

Run the new integration test plus any existing activity/format tests.  
Expected: PASS. Failed-step reveal on show still works (effect already waits for rects).

---

### Task 4: Run full `getDiff` only for projects whose Diff tab is watched

**Files:**
- Modify: `src/local/events.mjs` — refcounted `diffProjects`
- Modify: `src/local/routes/events.mjs` — `POST /api/events/interest` (or `/api/watch`)
- Modify: `src/local/ade-local.mjs` — `refreshBootstrapInBackground`
- Modify: `src/components/ade/SessionView.tsx` — watch while `rightTab === "diff"`
- Modify: client helper in `src/lib/ade/store.tsx` or `src/lib/ade/api.ts`
- Test: `src/local/events.test.mjs` + a refresh test that stubs/spies `getDiff`

**Interfaces:**
- Consumes: `{ projectId: string, diff: boolean }` interest posts; existing SSE client set
- Produces: on the 10s tick, `projectInfo` + `refreshDevProcess` for the current project set; `getDiff` only for projects with `diffWatchCount > 0`. Opening Diff triggers one immediate refresh for that project.

Keep calling `getDiff` from: turn end, session create / baseline, `GET /api/sessions/:id/diff`, `GET /api/projects/:id/diff`, load recovery. Those are not this timer.

Do not put single-flight in scope. Stay away from the 1s `computerWatchTimer` and the 60s agent probe except that they continue to start/stop with SSE clients as today.

- [ ] **Step 1: Failing tests for interest + gated refresh**

```js
test("diff interest is refcounted per project", () => {
  const hub = createEventHub();
  hub.watchDiff("p1");
  hub.watchDiff("p1");
  assert.deepEqual(hub.diffProjects(), ["p1"]);
  hub.unwatchDiff("p1");
  assert.deepEqual(hub.diffProjects(), ["p1"]);
  hub.unwatchDiff("p1");
  assert.deepEqual(hub.diffProjects(), []);
});

test("background refresh skips getDiff when nothing watches that project", async () => {
  // Arrange a project + non-complete session, empty diff watch set.
  // Spy getDiff; run refreshBootstrapInBackground([projectId]).
  // Assert getDiff not called; projectInfo still called.
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `node --test src/local/events.test.mjs` (and the new refresh test file).  
Expected: FAIL on missing `watchDiff` / still calling `getDiff`.

- [ ] **Step 3: Implement watch + gate**

In `events.mjs`:

```js
const diffWatch = new Map(); // projectId -> count
// watchDiff(id) / unwatchDiff(id) / diffProjects() => [...diffWatch.keys()]
```

Route: `POST /api/events/interest` with `{ projectId, diff: true|false }`. Auth/local-only same as other local routes.

In `refreshBootstrapInBackground`:

```js
const needsInfo = new Set([
  ...state.sessions.filter((item) => item.status !== "complete").map((item) => item.projectId),
  ...activeProjectIds,
]);
const needsFullDiff = new Set(eventHub.diffProjects());
for (const p of state.projects.filter((project) => needsInfo.has(project.id))) {
  await projectInfo(p);
  if (!p.missing && !isHiddenProject(p)) await refreshDevProcess(p);
  if (p.missing || !needsFullDiff.has(p.id)) continue;
  const diff = await getDiff(p);
  // assign session.changes as today
}
```

In `SessionView` (or Shell if that owns `rightTab` for the session pane):

```tsx
useEffect(() => {
  if (rightTab !== "diff" || !projectId) return undefined;
  void watchDiff(projectId, true);
  return () => {
    void watchDiff(projectId, false);
  };
}, [rightTab, projectId]);
```

On `diff: true`, server should also kick one `getDiff` for that project so the pane is not empty for up to 10s.

- [ ] **Step 4: Run focused tests**

Run: `node --test src/local/events.test.mjs src/local/*refresh*.test.mjs` (actual new filenames).  
Expected: PASS. Confirm porcelain/`projectInfo` still updates branch and uncommitted file lists without hunks.

---

### Task 5 (follow-on): Transcript virtualization — separate PR

**Do not start this in the same batch as Tasks 1–4 unless idle cost is already fixed and a profile shows long-thread hitching.**

**Files (when scheduled):**
- Modify: `src/components/ade/SessionThread.tsx`
- Modify: `src/components/ade/WorkspaceChat.tsx` — stop raw `messages.map`; reuse `SessionThread`
- Add dependency: `@tanstack/react-virtual` (Paseo / OpenHands pattern)
- Keep: Ctrl/Cmd+F reveals all (existing behavior); server `GET /api/sessions/:id` can stay full-array until a later paging task
- Test: extend `src/components/ade/session-thread.integration.test.mjs`

**Why later:** Verifiers confirmed payload + keep-mounted DOM costs. The 40-row window only helps first paint. Goose’s head/tail cut is the wrong peer because its find path mounts everything, which ADE already does. Virtualization needs a dependency and does not remove idle Chrome/git/log work.

**Minimum first slice inside Task 5 if split further:** route `WorkspaceChat` through `SessionThread` with the existing 40-window (no new dependency). Then add the virtualizer so scrolled-away rows unmount.

---

## Out of scope (verified do-not-copy)

| Tempting copy | Why not |
| --- | --- |
| t3code / Synara warm provider sessions (2–30 min) | ADE already drops the CLI per turn; warm retention is the opposite trade (t3code #42123) |
| Detached PTY worker / Orca daemon | Premature; stop the hidden poll first |
| Single-flight on bootstrap refresh | Already present via `refreshboardingBootstrap` |
| Dropping `logs:` when Activity is hidden | Breaks transcript `currentActivity` and computer line count |
| Treating pane CSS `hidden` as `document.hidden` | Screencast rest only watches the document; in-app tab switch never sets it |
| OpenHands screenshot-only browser | Product change; ADE’s interactive computer stays; only the unused JPEG loop stops |

---

## Self-review

1. **Spec coverage:** Screencast, git diff timer, activity hidden format, terminal hidden poll, transcript follow-on, and explicit non-goals are all tasked.
2. **Placeholder scan:** No TBD steps; each task has concrete files and assertions.
3. **Type consistency:** `streamWanted`, `shouldPollTerminal`, `watchDiff` / `unwatchDiff` / `diffProjects` names are stable across steps.
4. **Independence:** Tasks 1–4 can ship as four PRs; none requires Task 5.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-11-26-ade-responsiveness.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session runs the tasks with checkpoints  

Which approach?
