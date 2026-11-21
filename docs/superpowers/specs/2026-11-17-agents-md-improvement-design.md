# AGENTS.md improvement design

Date: 2026-11-17
Status: approved in conversation; awaiting file review before implementation plan

## Goal

Replace the Lovable-only `AGENTS.md` with standing agent rules based on the provided template, plus a short always-loaded ADE slice that stops common footguns. Keep the file small: rules agents miss, not a second README.

## Decisions already locked

- **Shape:** single flat `AGENTS.md` (no companion agent-doc file for this pass).
- **ADE depth:** template + filled never-lists + short ADE invariants + pointers (option B).
- **Lovable:** keep `LOVABLE:BEGIN/END` markers near the top, and list history rewrite under hard never-rules (option A).
- **Checks:** claim-done requires `typecheck`, `lint`, `build`, and `npm test`; focused `node --test <files>` is allowed while iterating (option C).

## File structure

1. Intro (template standing-rules preamble + conflict-with-human → ask).
2. Lovable marked block (existing text, preserved).
3. §1 Spell out dangerous actions (template + filled ADE blanks + affect-list/verify loop).
4. ADE invariants (short always-loaded block; see below).
5. §2–§7 from the template, with ADE-flavored notes only where needed (checks, agent-mistake regressions, isolated data).
6. Before you finish (template checklist + ADE check commands).

## §1 Never-lists (project-specific)

### Live data you must never touch

- `~/.ade/` including `workspace.json`, `session-logs/`, `sessions/`, `attachments/`, `remote-token`, browser profiles, ACP installs under `acp/`, tools, skills, and model-listing cache.
- Other projects registered in ADE’s workspace (real user repos ADE points at). Do not edit, move, or “clean up” those trees via ADE APIs or opportunistic scripts unless the human named that path for this task. Editing this ADE repository itself is normal work.
- Agent CLI credential stores outside this repository (Codex, OpenCode, Claude Code, Pi auth files and OS keychains).

### Processes or services you must never kill

- A running ADE instance the human is using (default port `3100`), its Chrome headless/headed browser, active agent CLI turns, or ADE-managed project dev servers — unless the human asked to stop that exact thing this turn.

### Other hard never-rules

- Do not build agent/tool command lines by shell string interpolation; use argument arrays through existing spawn helpers.
- Do not pass Codex sandbox-bypass flags, OpenCode `--auto`, or invented approval-bypass flags.
- Do not rewrite published git history (force push; rebase/amend/squash of already-pushed commits) — Lovable sync depends on intact history.
- Do not weaken, skip, or delete a test, lint rule, or check to make a change look green.
- Do not run `npm publish` or otherwise release `@dezignerdrugz/ade` unless the human explicitly asked.
- Tests that import `ade-local` (or otherwise load ADE’s data dir via `os.homedir()`) must set `HOME` and `USERPROFILE` to a temp directory before that import — never the real `~/.ade`.

Before edit: list what the change can affect (files, APIs, data, tests, docs, user-visible behavior). After edit: check that list again and state what was verified.

## ADE invariants (always-loaded)

1. **Honesty:** Surface real CLI/API failures (quota, auth, `model_not_found`, and similar). Never substitute simulated success, fake diffs, or fabricated agent output.
2. **Isolation:** Use sandbox, fixture, or generated copies. Remap `HOME`/`USERPROFILE` before importing the local service. Do not point migrators, debug scripts, or ad-hoc tools at live `~/.ade`.
3. **Spawn:** Child processes use argv arrays via existing spawn helpers — no shell string building for agent or tool commands.
4. **One ADE bind:** Default port `3100` is shared by `npm run dev` and installed `ade`. Do not start a second listener without an explicit alternate port.
5. **Pointers (not essays):** Local service changes live under `src/local/` (`ade-local.mjs`, `routes/`, area modules). CLI adapters live under `src/local/adapters/`. Product and safety detail on demand: `README.md`, `docs/adr/`.

## Checks (local = contract)

There is no in-repo GitHub Actions workflow today. The enforced local contract is:

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

While iterating, `node --test <changed test files>` is allowed. Before claiming done, run the full set above. Do not invent a lighter path that can pass while the full suite fails. If scripts or selection logic change, update `AGENTS.md` in the same change.

## Template sections kept as standing rules

- **§2 Automate recurring corrections** — prefer lint/type/unit/CI checks over repeated prose warnings.
- **§3 Keep agent context small** — add a rule only when agents miss it; when adding, remove something stale.
- **§4 Make local checks match CI** — same commands and selection as the contract above.
- **§5 Test agent behavior** — especially adapter/CLI decoding and `HOME` isolation regressions; do not delete a test that caught a real agent mistake.
- **§6 Do not let review bots decide correctness** — bot comments are leads; enforced checks + human satisfaction decide readiness.
- **§7 Use current docs and isolated data** — look up official docs for the library/CLI version in use; never aim agents/tests/scripts at live ADE data.

## Before you finish

- Same checks as the contract passed.
- Never-list items untouched (especially real `~/.ade` and user project folders).
- New or changed behavior has a test; any agent mistake hit this turn has an automated check when feasible.
- This file and other agent instructions did not grow without reason.

## Out of scope

- Rewriting `README.md` or ADRs.
- Adding CI YAML.
- Inventing new lint rules in this pass unless writing the file surfaces a repeated miss that belongs in automation instead of prose.

## Implementation note

Replace `AGENTS.md` contents in one change. Preserve Lovable markers exactly. Prefer positive target wording next to hard guardrails. Keep net size disciplined: every ADE line must earn always-loaded cost.
