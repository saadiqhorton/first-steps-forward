# Processes workshop

A static comparison page for the **Processes** area of ADE, built from Enjoy's
Previews & processes manual (guides 08.06–08.09) and ADE's own source.

Open `index.html`, or run the rendered check:

```bash
node tools/check.mjs
```

The check serves the folder, loads all four options, runs the search → select →
stop → mark-good → stop-all loop, checks the console dock, the card sheet,
Escape, the scenario/theme controls and reset, and writes screenshots to
`shots/`.

## What the page compares

| # | Name | Shape | Best at | Costs |
| - | ---- | ----- | ------- | ----- |
| 1 | Ledger | Project section, list + detail split | Reading output while managing the list | Uses the whole page; no conversation beside it |
| 2 | Rail | Right-pane tab, rows expand in place | Staying in the conversation | Short window for long output |
| 3 | Console | Full-width table + docked output | Long logs and many processes | Weaker at-a-glance list; a lot of chrome |
| 4 | Cards | Conversation-grouped cards + detail sheet | Scanning several processes quickly | Little output on the face; sheet covers the list |

All four share the same sample data, chrome, scenarios and behaviour:

- Processes grouped under the conversation that started them.
- Statuses: Running, Starting…, Stop requested…, Needs checking, Couldn't stop, Stopped.
- Search across name, command, address, source and conversation.
- Address with copy, **Open** (mock), **Stop**, **Stop all processes…** with confirmation.
- **Mark as good** / **Mark all as good** for processes ADE can't confirm.
- Output with **Wrap output lines**, **Follow latest** (pauses when you scroll up),
  line count and a docked/sheet console.
- Empty state: “Nothing running yet”.

## Controls

- **Scenario** — Mixed (one needs checking), 2 to check, Starting, Stop fails, Nothing running.
- **Theme** — light or dark mock, using ADE's tokens.
- **Output** — short lines or one deliberately long line, to test wrapping.
- **Reset** — clears the scenario's outcomes, selection, search, drafts and timers.

Every control writes to local sample data only. Nothing here calls ADE's API or
starts/stops a real server.

## What is honest to ADE

ADE currently owns one dev server per project (a `package.json` dev script or a
user-approved command) and records its folder, command, port, pid and output.
The mock shows only those facts. Agent-owned background jobs, multiple addresses
per process, and remote previews do not exist in ADE today and are not invented
here.

## Implementation notes

- Option 1 maps to a new `/p/$projectId/processes` route and project section tab.
- Option 2 maps to a `Processes` right-pane tab.
- Option 3 maps to a table + docked console in the same route.
- Option 4 maps to a card grid + sheet in the same route.
- The backend needs a process detail/output endpoint, an acknowledge endpoint and
  a stop-all endpoint, and `sessionId` recorded when an agent starts the server.

## Files

```
index.html            page chrome, overview, option view, controls
workshop.css          workshop page styles (outside the mock)
shared.css            ADE tokens and mock atoms (inside the mock)
workshop.js           registry, sample data, chrome, shell
options/option-N.js   one direction each, scoped under .opt-N
tools/check.mjs       rendered check + screenshots
shots/                check output
```


## Inline process chips

Under the agent's reply, a command keycap and an address link:

- **Stopped or failed** shows a Play mark; selecting it runs the command and opens the site once the port answers.
- **Running** shows a Terminal mark; selecting it opens the process in Processes, while the address opens the site in ADE's browser.
- **Needs checking** shows a Terminal mark and opens Processes so the output can be read and marked good.
- The keycap is deliberately tactile: paper surface, a top highlight, a 3px bottom lip and a small offset shadow. It presses down.

The row list in Option 1 is the same anatomy as the app: a 6px port light, name, address and status on two lines, an icon-only Open, a neutral selected surface, and a rule between conversation groups. The reminder for processes that need checking is a single quiet line with a brass dot.

## ADE in Processes

A **Processes** project tab beside Skills opens ADE itself in every project and shows:

- **ADE · This app** — the window you are using, with its address.
- **ADE dev server · Unmanaged** — another ADE on loopback that shares this project,
  such as one started in a terminal.

Both rows are read-only Open links. The agent servers stay in the right-pane
Processes tab, which does not mix ADE's own rows into its count or **Stop all**.
Unmanaged detection needs the ADE checkout added and is cached for a few seconds; an
installed ADE started from another folder still shows **This app**.

## Unslop pass

The page and the mocks had a polish pass with [unslop](https://github.com/heydamir/unslop)
by Damir Sokolovsky (CC BY 4.0): sentence-case labels, no text under 11px, one 14px icon set,
neutral surfaces with one brass accent, quiet counts, and the newest output line marked with a
brass rule. The direction, audit and nine passes are in `UNSLOP.md`.
