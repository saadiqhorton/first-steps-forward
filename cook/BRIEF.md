# Brief: Customize ADE

Target: a working "Customize ADE" feature inside ADE. Users describe a feature, tool or behavior change; an agent builds it in a private copy of ADE's source; ADE checks it, previews it, and keeps or undoes it; kept changes survive ADE updates. Stack: React + TanStack Start SPA, the local Node service (`src/local/`), the `ade` CLI launcher.
Worktree: `/home/dezignerdrugz/Work/first-steps-forward-customize`, branch `customize-ade` from `design-system-quick-wins` (53d88e6). Dev server for this run: port 3200 with HOME remapped to a temp dir. Never port 3100, never the real `~/.ade`.

References (recreate closely; the live ADE is the authority on look):
- R01 live ADE now, dark, project new-conversation screen. R02 live project shell (rail, conversation, right pane), light. R03 live phone assistant.
- W01–W08 the chosen workshop direction, Option 2 "Workbench" (`artifacts/customize-ade-workshop/`, main checkout): start, ready with preview, check fails, kept changes, update needs you, first visit, light, phone. W-shots are 100% mock captures; their right pane is clipped by the workshop frame.

Bar (eyeballed vs references, 0–100): layout and spacing 90; color and theme 95; typography and components 90; detail density 85; interaction clarity 90. Behaviour bar: every step of the flow works for real against a real agent CLI and real checks, verified by tests and a scripted browser run.
Calibration offset: none yet.

Rules:
- Functionality only: a customization may not change `src/tokens.css`, `src/styles.css`, `design/`, or the base UI components; a check enforces it. Customize ADE's own UI uses only existing tokens and components; `npm run token-audit` has zero errors.
- Users never see git, branches, builds or ports as concepts. One entry point, plain words. Setup stays one command (`npx @dezignerdrugz/ade`), no config.
- The agent never edits the running ADE's files. Keep it only after all checks pass, and the swap waits until no agent turn is running. Failed start rolls back automatically. `ade --stock` runs ADE without changes.
- Honesty: real CLI/API/check failures are shown as they are; no simulated success.
- AGENTS.md rules apply: argv spawns via existing helpers, HOME isolation in every test that imports `ade-local`, no Codex sandbox bypass, no `npm publish`, no force push, no secrets.
- Phones (`--remote`) can customize; builds run on the host.
- Default cook slop bans apply to new UI copy and visuals.

Time: cap 10h of build across rounds (round length 60–120 min). Started 2026-11-20 18:20 EST.
Usage: not readable; pace parallel subagents moderately (earlier in this session one model ran out of credits).
Deliverable: the feature working on branch `customize-ade`, local commits at the end of each round, full checks passing (`npm run typecheck`, `lint`, `build`, `test`, `token-audit`), stills per round. No push, no npm publish. The user reviews before anything merges into their branch.
Permissions: downloads yes (cook skill fetched from github.com/Leonxlnx/cook). Push no. Publish no.

Decisions already made with the user (do not reopen):
- Private copy of ADE's source shipped inside the main npm package (no companion package). GitHub repo is now public.
- Changes are kept as local commits in the copy; on upgrade an agent re-applies them, asking the user only if it fails ("Let the agent try again / Update without it / Stay on <old version>").
- UI: Workbench layout (Option 2): Changes rail (All / Needs you / Working / Kept, flat list under All), the change's conversation in the middle, right pane Preview / Checks / Changes, Try it / Keep it / Undo reachable when the pane is collapsed. Top-bar tab "Customize ADE" right of Luna.
- Theming/design changes are out of scope for customizations.

User's words: "I want to add a mode to our ade project to where we can directly work on the ade project itself and update it, basically so users can add their own features or whatever they want or alter ade exactly how they need wherever they have it spun up" / "i don't want it to be complicated on user's end" / "only focus on functionality, tooling, features" / "I would want customize ade up next to right of Luna tab" / "i like the concept behind 2 better. but when we build it out, let's use cook skill to ensure that it has everything it needs and realistic in all the ways it should function within ade and matching design system." / "we can make github repo public, go ahead and start"
