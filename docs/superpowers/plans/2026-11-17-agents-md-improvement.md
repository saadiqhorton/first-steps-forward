# AGENTS.md Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Lovable-only `AGENTS.md` with standing agent rules plus a short ADE always-loaded slice, matching the approved design.

**Architecture:** Single flat `AGENTS.md`. Preserve the Lovable marker block. Keep product/architecture detail behind pointers to `README.md` and `docs/adr/`. No companion agent-doc file, no CI YAML, no README rewrite in this pass.

**Tech Stack:** Markdown only (`AGENTS.md`). Spec: `docs/superpowers/specs/2026-11-17-agents-md-improvement-design.md`.

## Global Constraints

- Single flat `AGENTS.md` (no new always-loaded companion file).
- Preserve `<!-- LOVABLE:BEGIN -->` / `<!-- LOVABLE:END -->` markers and existing Lovable text exactly.
- Claim-done checks: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`; focused `node --test <files>` allowed while iterating.
- Prefer positive target wording next to hard guardrails; every ADE line must earn always-loaded cost.
- Out of scope: README/ADR rewrites, adding CI YAML, inventing new lint rules unless a repeated miss appears while writing.

---

### Task 1: Write AGENTS.md

**Files:**
- Modify: `AGENTS.md` (full replace of contents; keep Lovable block text/markers)
- Reference: `docs/superpowers/specs/2026-11-17-agents-md-improvement-design.md`
- Reference: user-supplied template in the original request

**Interfaces:**
- Consumes: locked decisions and never-lists from the design spec
- Produces: the standing `AGENTS.md` all future agents load

- [ ] **Step 1: Replace `AGENTS.md` with this exact content**

Write the full file (overwrite). Do not drop or reword the Lovable block body; markers stay where shown.

```markdown
<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md

Standing rules for any coding agent working in this repository. Follow them on every change. Do not wait to be reminded. Prefer making a mistake easy to catch, contained, and cheap to undo over writing a longer prompt.

If a rule here conflicts with a direct request from the human, stop and ask before doing the dangerous part.

## 1. Spell out dangerous actions

Never do the following unless the human explicitly asked for that exact action in this turn, and even then confirm first if the action cannot be undone:

- Do not read, write, move, delete, or overwrite live application data, production databases, user vaults, or real user files. Work only on sandbox or fixture copies.
- Do not kill processes by name, restart shared services, or change production infrastructure.
- Do not run destructive git commands (push --force, reset --hard, hook-skipping commits, rewrite of published history) unless the human asked for that exact command and understands what it will overwrite.
- Do not commit secrets, credentials, or personal data. Do not log them. Do not put them in chat.
- Do not weaken, skip, or delete a test, lint rule, or CI check to make a change look green.

### Live data you must never touch

- `~/.ade/` — `workspace.json`, `session-logs/`, `sessions/`, `attachments/`, `remote-token`, browser profiles, ACP installs under `acp/`, tools, skills, and model-listing cache.
- Other projects registered in ADE's workspace (real user repos ADE points at). Do not edit, move, or clean them up via ADE APIs or opportunistic scripts unless the human named that path for this task. Editing this ADE repository itself is normal work.
- Agent CLI credential stores outside this repository (Codex, OpenCode, Claude Code, Pi auth files and OS keychains).

### Processes or services you must never kill

- A running ADE instance the human is using (default port `3100`), its Chrome headless/headed browser, active agent CLI turns, or ADE-managed project dev servers — unless the human asked to stop that exact thing this turn.

### Other hard never-rules

- Build agent and tool command lines as argument arrays through existing spawn helpers; do not shell-interpolate argv.
- Keep Codex sandbox and OpenCode defaults honest: do not pass Codex sandbox-bypass flags, OpenCode `--auto`, or invented approval-bypass flags.
- Keep published git history intact for Lovable (no force push; no rebase/amend/squash of already-pushed commits) unless the human asked for that exact action and understands the overwrite.
- Do not run `npm publish` or otherwise release `@dezignerdrugz/ade` unless the human explicitly asked.
- Before any test or script imports `ade-local` (or otherwise resolves ADE's data dir via `os.homedir()`), set `HOME` and `USERPROFILE` to a temp directory — never the real `~/.ade`.

Before you edit, list what the change can affect: files, APIs, data, tests, docs, and user-visible behavior. After you edit, check that list again and say what you verified.

## ADE invariants

1. **Honesty:** Surface real CLI/API failures (quota, auth, `model_not_found`, and similar). Never substitute simulated success, fake diffs, or fabricated agent output.
2. **Isolation:** Use sandbox, fixture, or generated copies. Remap `HOME`/`USERPROFILE` before importing the local service. Do not point migrators, debug scripts, or ad-hoc tools at live `~/.ade`.
3. **Spawn:** Start child processes with argv arrays via existing spawn helpers.
4. **One ADE bind:** Default port `3100` is shared by `npm run dev` and installed `ade`. Do not start a second listener without an explicit alternate port.
5. **Pointers:** Local service changes live under `src/local/` (`ade-local.mjs`, `routes/`, area modules). CLI adapters live under `src/local/adapters/`. Product and safety detail on demand: `README.md`, `docs/adr/`.

## 2. Automate recurring corrections

If the same review comment, failed check, or agent mistake shows up more than once, do not keep warning about it in prose. Add a lint rule, type check, unit test, or CI step that fails automatically. Prefer a check the agent cannot ignore over another sentence in this file.

## 3. Keep agent context small

Keep this file, skills, and tool descriptions short. Add a rule only when agents actually miss it. Do not paste architecture essays, ticket history, or docs the agent can open on demand.

If you need to change this file or any agent instruction, keep the net size down: remove something stale when you add something new. Do not add tool descriptions or prompt text that crowd out the task.

## 4. Make local checks match CI

There is no in-repo GitHub Actions workflow today. The enforced local contract is:

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

While iterating, `node --test <changed test files>` is fine. Before claiming done, run the full set above. Do not invent a lighter local shortcut that can pass while the full suite fails. If you change these scripts or their selection logic, update this file in the same change.

## 5. Test agent behavior

When an agent makes a meaningful mistake, including one caused by a prompt or instruction, add a regression test (or an automated check) that would have failed. The next agent should hit that check, not a verbal reminder. Adapter/CLI decoding and `HOME` isolation mistakes are high-value checks here.

Write tests for the behavior users rely on, not a pile of weak smoke tests. Do not delete or weaken a test that caught a real agent mistake.

## 6. Do not let review bots decide correctness

AI review comments are leads, not proof and not approval to merge. Give review bots a narrow job (for example, "flag only bugs in this diff"). Verify every finding yourself against the code and the failing or passing checks.

A change is ready when the enforced checks pass and the human is satisfied. A review bot thumbs-up is never sufficient. Do not treat a review bot's silence as a pass either.

## 7. Use current docs and isolated data

When you use a library or API, look up current official docs for this version. Do not rely on memory or outdated examples. For agent CLIs ADE wraps, use that CLI's current docs for the installed version.

Use sandbox, fixture, or generated copies of data. Never point an agent, a test, a migrator, or a debug script at the live installation's data (`~/.ade` or other registered projects). If a task seems to require live data, stop and ask for a copy or a safer path.

## Before you finish

- You ran `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`, and they passed (or you ran focused `node --test` while iterating and finished with the full set).
- You did not touch live data or other items in the never-list.
- New or changed behavior has a test, and any agent mistake you hit now has a check.
- This file and other agent instructions did not grow without reason.
```

- [ ] **Step 2: Spec coverage check (manual)**

Open `docs/superpowers/specs/2026-11-17-agents-md-improvement-design.md` and confirm each locked item appears in `AGENTS.md`:

| Spec requirement | Must appear in AGENTS.md |
| --- | --- |
| Lovable markers + body preserved | `LOVABLE:BEGIN` / `LOVABLE:END` unchanged |
| `~/.ade/` never-touch list | present |
| Other registered projects clarified (this repo OK) | present |
| CLI credential stores | present |
| Don't kill ADE/Chrome/CLI turns/dev servers | present |
| argv arrays / no shell interpolation | present |
| No sandbox-bypass / `--auto` / invented bypass | present |
| No history rewrite (Lovable) | present |
| No `npm publish` unless asked | present |
| `HOME`+`USERPROFILE` before `ade-local` import | present |
| Honesty invariant | present |
| Isolation invariant | present |
| Spawn invariant | present |
| One ADE bind / port 3100 | present |
| Pointers to `src/local/`, adapters, README, ADRs | present |
| Check contract includes typecheck, lint, build, test | present |
| Focused `node --test` while iterating | present |
| Template §§2–7 + before-finish | present |

Expected: every row covered; no README rewrite; no new companion agent doc.

- [ ] **Step 3: Size / duplication prune**

Re-read `AGENTS.md`. If the same meaning appears twice (for example spawn ban + spawn invariant), keep the never-list as the hard guardrail and the invariant as the positive target — do not add a third restatement. Confirm the file still fits on one focused screenful of attention (rough guide: under ~150 lines). If it ballooned with essays, cut back to the design's always-loaded slice.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
Document standing agent rules and ADE safety invariants.

EOF
)"
```

Only commit if the human asked for a commit this turn; otherwise stop after Step 3 and report the file ready for review.

---

### Task 2: Optional design/plan commit (human-gated)

**Files:**
- Create (already on disk): `docs/superpowers/specs/2026-11-17-agents-md-improvement-design.md`
- Create (already on disk): `docs/superpowers/plans/2026-11-17-agents-md-improvement.md`

**Interfaces:**
- Consumes: Task 1 complete `AGENTS.md`
- Produces: committed design + plan only when the human wants them in git

- [ ] **Step 1: Ask before committing docs**

If the human wants the design and plan committed too:

```bash
git add \
  docs/superpowers/specs/2026-11-17-agents-md-improvement-design.md \
  docs/superpowers/plans/2026-11-17-agents-md-improvement.md \
  AGENTS.md
git commit -m "$(cat <<'EOF'
Add AGENTS.md standing rules with ADE never-lists and invariants.

EOF
)"
```

If they only want `AGENTS.md`, commit that alone (Task 1 Step 4). If they want no commit, leave everything unstaged and stop.

---

## Self-review (plan author)

1. **Spec coverage:** All locked decisions and never-list items are inlined into Task 1's exact file body. Out-of-scope items are excluded.
2. **Placeholder scan:** No TBD/TODO; full Markdown body provided.
3. **Consistency:** Check commands match the design (typecheck, lint, build, `npm test` + focused `node --test`). Lovable markers match the current file.
