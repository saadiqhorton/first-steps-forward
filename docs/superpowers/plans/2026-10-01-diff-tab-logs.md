# Diff Tab + Log Auto-scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Diff right-pane tab with Files changed; keep Logs in Activity with stick-to-bottom auto-scroll.

**Architecture:** Extend `RightTab` with `diff`. Shell shows Diff between Activity and Preview and keeps the existing right-pane portal host visible for both Activity and Diff. SessionView portals ActivityPanel and a thin DiffPanel, showing one based on `rightTab`. ActivityLogs gains the SessionView stick-to-bottom pattern.

**Tech Stack:** React, TanStack Router search `pane`, existing DiffView / ActivityPanel.

## Global Constraints

- Do not redesign DiffView or log formatting — move only
- Tab order must be Activity · Diff · Preview · Terminal
- Keep `editor` as obsolete pane alias behavior unchanged

---

### Task 1: Wire `diff` into navigation + Shell tabs

**Files:**
- Modify: `src/lib/ade/navigation.ts`
- Modify: `src/routes/p.$projectId.conversations.tsx`
- Modify: `src/components/ade/Shell.tsx`

- [ ] **Step 1:** Add `"diff"` to `RightTab` and conversations `rightTabs` / Shell `RIGHT_TABS`.
- [ ] **Step 2:** Insert Diff tab button after Activity; show portal host when `rightTab` is `activity` or `diff`; set aria ids for the Diff tab.
- [ ] **Step 3:** Confirm `?pane=diff` is accepted by existing pane consume effect.

### Task 2: Split Activity vs Diff content

**Files:**
- Modify: `src/components/ade/ActivityPanel.tsx`
- Create: `src/components/ade/DiffPanel.tsx`
- Modify: `src/components/ade/SessionView.tsx`

- [ ] **Step 1:** Remove Files changed section from ActivityPanel (keep Agent context, Checks, Logs).
- [ ] **Step 2:** Add DiffPanel wrapping the same DiffView + files label used before.
- [ ] **Step 3:** Portal both panels from SessionView; show Activity when `rightTab !== "diff"`, Diff when `rightTab === "diff"` (keep both mounted with hide/show so state is preserved). Use `useShell().rightTab`.

### Task 3: Log auto-scroll

**Files:**
- Modify: `src/components/ade/ActivityLogs.tsx`

- [ ] **Step 1:** Track stick-to-bottom on the log list scroll container (~80px threshold).
- [ ] **Step 2:** On new rows, scroll to end when sticking.
- [ ] **Step 3:** Manual check in the running app on :3100 — open a session with logs, confirm follow + pause on scroll-up.

### Task 4: Verify

- [ ] **Step 1:** `npm run lint` (or project’s usual check) on touched files.
- [ ] **Step 2:** Spot-check Activity / Diff / Preview tabs in the browser.
