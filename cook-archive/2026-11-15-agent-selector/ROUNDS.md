# Cook ledger: ADE selector and updater

Started: 2026-11-15 09:25 America/New_York
Time: one-hour cap, confirmed by user.
Bar: layout, color, typography/components, detail density, interaction each 99.9 (eyeballed).
Calibration: none. Usage: not readable. Gate: stills approved no; UI final render is not applicable.
Best so far: r05 (chevrons for one-of columns, row rhythm, and Homebrew update support); earlier rounds were not re-scored on the same scale.

## Decisions

- Use existing ADE capabilities, never manufacture unavailable options or usage data.
- Work in the current dirty workspace without committing unrelated edits.
- The user's requested deliverable is runnable UI code, not a video; expensive final-render gate does not apply to normal implementation and testing.

- Keep ADE’s existing design system; use references for structure and behavior.

## User feedback inbox

- "our ade project model selector part needs to match up more properly with how enjoy.dev handles. also we need to ensure that the updater is properly detecting updates timely and we can seamlessly update in ade ui." | open
- "make sure it still follows our design system tho for our ade project" | open


## Round 01

Time: 09:25–09:29 America/New_York; usage not readable.
Focus: five-column hierarchy, actionable defaults and update controls in ADE's own theme.
Changes: compact selection rows, readable labels, working default model, update checking and progress. Stills: `cook/stills/r01/`; comparisons: `cook/compare/r01/`.
Eyeballed independent critic scores, median of two, no calibration: R01 layout 72, color 92, typography/components 75.5, density 56; R02 layout 72.5, color 92, typography/components 74, density 56; R03 layout 68, color 92.5, typography/components 77.5, density 63.5. Interaction not scored from stills. Own score: not recorded.
Measured: full-image R02 saturation +0.091, brightness -0.108 versus reference; backgrounds differ intentionally, so this is not a picker-only color metric.
Top gaps: shorter model list, sparse account details, missing reference-only permission/preset controls. Usage/account data and those modes are not available in ADE and must not be fabricated.
Progress note sent; stop check: visual bar not met, stills not approved. Next: denser rows, more vertical room, and verify updater and selector interactions.


## Round 02

Time: 09:29–09:33 America/New_York. Usage not readable.
Focus: model-list height and unnecessary agent status density.
Changes: compact rows, more vertical space, avoid repetitive Ready labels, maintain ADE theme; added end-to-end interaction and update recovery tests. Stills: `cook/stills/r02/`; comparisons: `cook/compare/r02/`.
Eyeballed independent critic scores, median of three, no calibration: R01 layout 78, color 89, typography/components 75, density 64; R02 layout 76, color 89, typography/components 72, density 51; R03 layout 83, color 90, typography/components 78, density 72. Interaction not scored from stills. Own score: not recorded. One critic incorrectly attributed usage bars to R03; a third was added due to score disagreement.
Measured: full-image R02 saturation +0.089, brightness -0.108 versus reference; backgrounds differ intentionally, so this is not a picker-only color metric.
Top gaps: missing real usage data, unavailable permission modes and presets; model-column hierarchy differs. Those backend features are not present and should not be fabricated.
Progress note sent; stop check: visual bar not met, stills not approved; no long final render applies to this runnable UI. Next: finish validation and inspect update status edge cases.

## Round 03

Time: 09:33–09:38 America/New_York. Usage not readable.
Focus: real saved presets and a dedicated action strip, without fabricating reference-only options.
Changes: local presets with validation and deletion; prevent concurrent agent turns during updates; end-to-end update and preset tests. Stills: `cook/stills/r03/`; comparisons: `cook/compare/r03/`.
Eyeballed independent critic scores, median of two valid critics, no calibration: R01 layout 78, color 90.5, typography/components 71, density 65.5; R02 layout 78, color 90.5, typography/components 69, density 63.5; R03 layout 84, color 91.5, typography/components 77, density 77.5. A third review misidentified the reference states and is excluded. Interaction not rated from stills. Own score: not recorded.
Measured: full-image R02 saturation +0.090, brightness -0.105 versus reference; backgrounds differ intentionally, so this is not a picker-only color metric.
Top gaps: actual agent usage/account information and additional permission modes are not available; row hierarchy and column widths differ. Progress note sent; stop check: visual bar not met, stills not approved; no long final render applies. Next: improve small viewport fit and keep live update/sign-in actions accessible.

## Round 04

Time: 09:38–09:41 America/New_York. Usage not readable.
Focus: fit the picker in short windows, restore ADE typography at full size, and align column proportions.
Changes: adaptive list height, wider picker, more balanced columns, clearer model-default label; added in-app updates to Agents & accounts. Stills: `cook/stills/r04/`; comparisons: `cook/compare/r04/`.
Eyeballed independent critic medians (two, no calibration): R01 layout 84, color 95.5, typography/components 72, density 69.5; R02 layout 81.5, color 95.5, typography/components 69.5, density 67; R03 layout 92, color 95.5, typography/components 82, density 82. Interaction not scored from stills. Own score: not recorded.
Measured: full-image R02 saturation +0.089, brightness -0.105 versus reference; backgrounds differ intentionally, so this is not a picker-only color metric.
Top remaining gaps: real agent usage/account data, additional agent-specific permission modes, and model-list presentation. Progress note sent. Stop check: 99.9 stretch bar not met; no long final render applies. Continue with reliability and validation; do not invent unsupported capabilities.

## Review and validation follow-up

Time: 09:42–09:47 America/New_York. Usage not readable.
Changes: ignore stale preset requests, refresh catalogs and capabilities when a CLI version changes, expose selected states to assistive technology, preserve updater results after reopening, and prevent the parent picker from closing a child dialog on Escape. Updater now waits for status on open and blocks new tasks while an install or update is active.
Measured: `npm test` passed 571 tests with 1 platform-specific skip using a non-symlink temporary directory; focused picker, updater, registry and running-task tests passed after the review fixes. `npm run build` and `npm run typecheck` passed. The initial full run hit a system temporary-directory quota; its failures passed on the later run.
Stills: `cook/stills/r04/`; comparisons: `cook/compare/r04/`. The review fixes do not change the rendered layout. The 99.9 visual stretch bar is not met; usage/account and additional permission data are not present in ADE and have not been invented. No long final render or publication applies to this UI task.


## Round 05 — Homebrew updates and picker polish

Time: resumed after a usage stop; 10:00–10:45 America/New_York. Usage not readable. The one-hour cap from the brief had already been spent by earlier rounds; this round finished the functional half rather than opening a new visual direction.

Focus: the open user request on update detection and in-app updating, plus the remaining row affordances visible in R01–R03.

Changes:
- Homebrew is now a first-class install method. `harness-brew.mjs` identifies the unique installed formula or cask that owns the resolved executable from `brew info --json=v2 --installed` and `brew list --verbose`, using an adapter allowlist (`claude-code` cask, `codex` cask, `opencode` and `pi-coding-agent` formulae). Detection runs before mise and never guesses on ambiguity.
- Update checks use `brew outdated --json=v2 --<kind> <name>` (status 1 is Homebrew's normal "outdated" answer), are cached like npm/mise checks, and never fall back to npm for a Homebrew-owned binary. A current result reuses the installed version.
- The update action builds `brew upgrade --<kind> <name>` from the detected item and is validated again in the agent route; an unverifiable identity is refused with 409. The agent picker and Agents & accounts treat Homebrew like npm/mise; agents installed some other way still say "update where you installed it".
- Tab focus, agent switches and CLI version changes continue to refresh catalogs; a finished install/update clears the model cache and re-probes.
- Picker: the selected effort, speed and permission rows now use the reference's trailing chevron; agent and model keep the check. Row height rose about 2px to match the reference rhythm.

Measured: `npm test` passed 601 tests with 1 platform-specific skip and 0 failures; `npm run typecheck` passed. A later guard against offering upgrades for pinned Homebrew packages re-ran harness-brew + harness (20/20) and typecheck, both passing. Other focused suites: agent-routes 13/13, agent-probe + adapters 37/37, picker browser integration passed after clearing a full system temporary-directory quota (the earlier run failed to write Vite's dependency cache, not on an assertion).

Stills: `cook-archive/2026-11-15-agent-selector/stills/r05/`; comparisons: `cook-archive/2026-11-15-agent-selector/compare/r05/` (the selector run was archived by a concurrent run while this round finished; paths updated).

Eyeballed critics, two fresh contexts, no calibration. Critic A: R01 layout 66, color 58, typography 62, density 52; R02 63/57/59/49; R03 71/60/65/55. Critic B (did not score color): R01 layout 80, typography 78, density 69; R02 76/75/65; R03 84/80/73. Medians: R01 73/58/70/60.5; R02 69.5/57/67/57; R03 77.5/60/72.5/64. Interaction not scored from stills. Both critics described the in-column option lists as closed dropdowns; the implementation renders the full list under the active row, as the references do, so that item is a misread and is not actioned. The color gap is ADE's own palette, which the user explicitly asked to keep.

Top remaining gaps: real per-agent usage meters, reset times, account actions and brand glyphs are not available in ADE and were not fabricated; ADE exposes only the permission modes and models its agents report. Model-list grouping still differs, though long ids wrap.

Stop check: the 99.9 stretch bar is not met and the stills were not approved, but every remaining item is either an unavailable capability or a deliberate design-system choice. No long final render or publication applies to this UI task.


## Round 06 — every permission mode the references show

Time: 11:00–11:20 America/New_York. Usage not readable.

Focus: the user's repeated feedback that all permission modes must match the references. Round 05 and earlier had shown only the modes ADE's agents reported; this round gives Claude and Codex the full reference sets and makes each choice real.

Changes:
- Claude Code now offers Manual, Accept edits, Plan, Auto, Don't ask and Bypass permissions. Manual uses the bridge's `default` mode, Accept edits `acceptEdits`, Plan `plan`, Auto `auto`, Bypass `bypassPermissions`. The bridge does not advertise Claude's `dontAsk` mode, so Don't ask runs in Manual and ADE itself declines every request that would prompt. `allowDangerouslySkipPermissions` is sent only when Bypass is selected, so the mode is advertised without enabling it otherwise.
- ACP turns accept `permission: "dont-ask"` and decline tool and mode-switch requests themselves, with a log entry and an explicit notice, never showing a prompt.
- Codex now offers Read-only, Ask for approval, Approve for me and Full access. Fresh `exec` uses `--sandbox read-only`, `--sandbox workspace-write`, `--approve-for-me` and `--dangerously-bypass-approvals-and-sandbox`; `exec resume` uses the equivalent `-c sandbox_mode`, `approval_policy="on-request"` and `approvals_reviewer="auto_review"` values, or the bypass flag. `build` remains the default id so existing sessions and presets keep their meaning.
- Permission ids, labels and presets accept the new values; the picker's fallback label map and the capability defaults know all of them.
- The visual harness now uses each adapter's real permission set, and its default selections mirror the reference states (Auto, Approve for me, Build).

Measured: focused suites `adapters + acp + agent routes + capabilities` passed 84/84; `npm run typecheck` passed. The full suite ran 605 tests: 602 passed, 1 skipped, and 1 unrelated dev-command test failed under parallel load (it passes 10/10 when run alone, and failed the same way before this round's changes). The picker harness captured `stills/r06` with six Claude modes, four Codex modes and OpenCode's Build/Plan.

Stills: `cook-archive/2026-11-15-agent-selector/stills/r06/`; comparisons: `cook-archive/2026-11-15-agent-selector/compare/r06/`.

Scores: no critic pass this round. The rendered change is a real option list whose correctness is covered by argv and capability tests, so a fresh full-screen similarity score would not add signal to the previous round.

Follow-up (same day): at the user's request the selected Effort, Speed and Permission rows use a check mark again instead of the round-05 chevron, so every selected row in the picker has the same affordance. Stills: `stills/r07/`. Typecheck passed and the live dev server picked the change up.

Stop check: the permission surfaces now match the references with real behavior. Remaining gaps are the unavailable usage/account block and brand glyphs, plus ADE's own palette.
