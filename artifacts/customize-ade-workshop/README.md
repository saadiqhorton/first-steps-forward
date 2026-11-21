# Customize ADE workshop

A static comparison page for a proposed new ADE page, **Customize ADE** at
`/workspace/customize`: describe a feature or behavior change, an agent builds it
in a private copy of ADE, ADE runs checks, you try it, then keep it or undo it.

Open `index.html`, or run the rendered check:

```bash
node tools/check.mjs
```

The check serves this folder (and `src/` read-only for the token imports), loads the
overview and every option in both themes and both widths, and runs the central
loop in each option: submit, building, checks, Try it, Copy log, Keep it, the
switching sequence, the change appearing in Your changes, and Remove. It also runs
Check fails (Keep it stays disabled), First visit setup, both update scenarios,
Reset, typing focus, console errors and 390px overflow. Screenshots go to `shots/`.

## The four directions

| # | Name | Shape | Tradeoff |
| - | ---- | ----- | -------- |
| 1 | Conversation | Luna's page; a change card in the agent's reply; Your changes in a sheet | Most familiar and lightest; kept changes are one click away |
| 2 | Workbench | Project shell: rail of changes, conversation, Preview / Checks / Changes pane | Most power and visibility; heaviest and most technical |
| 3 | Ledger | Settings/Inbox pattern; composer plus a grouped card of rows that expand | Calmest and simplest; least room to steer the agent |
| 4 | Guided | Step track (Describe, Build, Try, Keep), one card per step | Clearest for first-timers; rigid for back-and-forth |

**Recommendation:** Option 1 as the default, with Option 3's change list as its Your
changes sheet. Building showed the change card needs a status pill and a reason when
Keep it is off. Option 2 only pays off with several parallel changes; Option 4 suits
the first-run setup.

## Shared behavior (identical in all four)

Engine in `workshop.js`: submit, streaming reply, five checks (Typecheck, Lint, Build,
Tests, Design files untouched), Try it with the preview on 127.0.0.1:3101, Keep it
(enabled only when every check passes) with Wait for agents to finish, Save workspace
backup, Restart ADE with your change, then "You're on your version.", Undo, Remove with
an in-page confirm, `ade --stock` hint, one-time setup, and the update decision
(Let the agent try again / Update without it / Stay on 0.1.15).

The top-bar tab (Wrench, right of Luna) shows idle, building (teal pulse) or needs you
(amber dot). On a phone the nav is hidden and Customize ADE is in the Projects menu.

## Controls

Scenario (First visit, Ready to build, Check fails, ADE update carries over, ADE update
needs you), Theme, Width (Desktop 1440, Phone 390), Reset. Reset rebuilds the option,
which clears drafts, timers and animations.

## What's mock

Everything. No build, restart, download, git or network call exists on the page. The
preview, the checks and the restart are drawn.

## Files

```
index.html          page chrome, overview, close-ups, option view, controls
workshop.css        workshop page styles (outside the mock)
shared.css          ADE tokens and mock atoms (inside the mock)
workshop.js         sample data, change engine, shared parts, shell
options/option-N.js one direction each, scoped under .opt-N
tools/check.mjs     rendered check + screenshots
shots/              check output
```

## Decision (2026-11-20)

The user prefers **Option 2, Workbench**, as the concept to build: changes in a left rail,
the change's conversation in the middle, and Preview / Checks / Changes in the right pane.
Not yet authorized for implementation. The build will run through the cook skill
(github.com/Leonxlnx/cook) so behaviour is real inside ADE and matches the design system.
Carry over from the review: flat rail list under All (like the live conversation rail),
and Try it / Keep it / Undo reachable when the right pane is collapsed.
