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

## Design tokens (UI)

Before writing or modifying any UI code, read the relevant design file in `design/`. Use only tokens from `src/tokens.css` (Layer 2 aliases) and the documented Layer-2-by-convention tokens (`--space-*`, `--text-*`, `--radius-*`, `--shadow-resting|raised|floating`, `--duration-*`, `--ease-*`). Layer-2-by-convention also includes existing ADE/Arc semantic color names (`--foreground`, `--background`, `--border`, `--text-muted`, `--ink`, `--paper`, `--panel`, `--danger`, `--accent`, etc.) alongside `--color-*` aliases — components may use either, never raw color literals. Do not introduce raw hex/rgb/oklch, px spacing, bare font sizes/weights, radii, shadows, z-index, or transition durations in component CSS. Run `npm run token-audit` before committing. Zero errors required.

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
