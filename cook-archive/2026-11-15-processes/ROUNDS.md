# Rounds: ADE Processes

## Decisions

- Process state stays in ADE's existing workspace records; no invented processes, ports or agents.
- The exact look is the user's call. The workshop carries four directions; the app ships the recommended Ledger so behaviour is real and testable.
- ADE manages one dev server per project today. The UI supports the record it has and says so; it does not fabricate agent-owned background jobs.
- The previous run (agent selector) moved to `cook-archive/2026-11-15-agent-selector/`.

## User feedback inbox

- "i want you to read all the docs on enjoy.dev on processes and how they handle it in their app." | read
- "use cook skill to implement it in our project." | in progress
- "Use design workshop also so i can decide on the exact look." | workshop ready, awaiting a pick

## Round 01 — workshop

Time: 10:10–11:05 America/New_York. Usage not readable.
Focus: four meaningfully different shapes for the Processes surface.
Built: `artifacts/processes-workshop` with shared sample data, scenarios (mixed, 2 to check, starting, stop fails, nothing running), light/dark, short/long output, reset, close-ups.
Measured: `node tools/check.mjs` — 4 overview cards, all four options mount, search narrows 3 → 1, Mark all as good clears the reminder, Stop shows Stop requested then removes the row, Stop all confirms then empties the list, console follow pauses on scroll, wrap toggles, card sheet opens and Escape closes it, empty and stop-fail scenarios, dark theme, reset, 600px no sideways scroll. All passed.
Own review: options differ in shape, hierarchy and interaction, not colour; close-ups show the row and output bar at real size. No reference images, so no similarity score.
Next: run fresh-context critics on the stills, then finish the app surface.

## Round 02 — the working surface

Time: 11:05–11:55 America/New_York.
Changes: `processes` project section and route; session recorded at start; API for list, detail, output paging, ack, stop-all; 15s liveness check with two misses → Needs checking; output follow/wrap/download; Open hands the URL to the Browser tab; stop-all confirms.
Measured: `src/local/processes.test.mjs` 7/7 pass; devcommand + persistence + local-server + spawn tests 23 pass, 1 platform skip; typecheck and build pass; a scripted browser run passes (search 3 → 1, needs-checking banner, mark as good, stop one, stop all confirm, empty state), 1440/820/600 render with no console errors or sideways scroll; Open sets the Browser pane address to `http://127.0.0.1:5188/`.
Own review: statuses and grouping read clearly; narrow stacks list over detail and the section scrolls so output stays reachable; the right pane still takes its share, as on every section.
Next: independent critic pass; act only on concrete gaps.

## Round 03 — critique and fixes

Two fresh-context critics scored the six stills without the run's reasoning.

Median scores (0–100, eyeballed): O1 Ledger 85 (native 90, hierarchy 88, density 82, states 80); O2 Rail 70; O3 Console 75; O4 Cards 62; implemented surface 78 (first critic 80, second 76). Both chose O1/Option 1's shape. Calibration: none from the user yet.

Accepted gaps and what changed:

- Rows repeated "Running" four times. Running is now the dot; only exceptions (Needs checking, Stop requested…, Couldn't stop) carry words, in the app and the workshop rows.
- The output bar made two contradictory claims (`Following log` beside `Follow latest`) and used three identical pills. It now shows one state: **Following log** at the newest line, **Scrolled back** plus one amber **Follow latest** button after you scroll up; **Wrap output lines** shows its on state; Download is an icon with an accessible label. Footer claim removed.
- "1 to check" was the loudest thing on the page. It is now a borderless tan callout with a plain link; amber fill is reserved for destructive actions.
- The empty state appeared twice. The list now says "Nothing running yet." and the detail carries the explanation.
- Stop-all copy now names what will stop ("2 processes will stop: Development server, Storybook.").
- Group-header glyph read as a checkbox. It is a 14px, lighter-stroke speech bubble in both the app and the workshop.
- Workshop O2's footer spacing and output footer were tightened; the apparent clipping was a full-page scaling artifact (confirmed by element bounds and a fresh element screenshot), so no structural change was made.
- Workshop close-up now demonstrates the scrolled-back output bar, not the following state.

Rejected/deferred: collapsing ADE's right pane on the Processes route, and removing the 3 in the section tab (kept; it is the project-level count). The narrow layout stacks list over detail and keeps output reachable by scrolling; the bottom-docked browser pane is the shell's behaviour on every section, not this page's.

Measured after fixes: workshop `tools/check.mjs` all pass (4 options, search, mark good, stop, stop-all confirm, console follow/wrap, sheet Escape, scenarios, dark, reset, 600px). App: typecheck and build pass; `processes.test.mjs` 7/7; lint clean; scripted browser run passes interaction and stop-all, 1440/820/600 with no console errors or sideways scroll; Open sets the Browser address to `http://127.0.0.1:5188/`; the liveness check flipped Storybook to `unverified` after two probes and `Mark as good` returned it to `running`.

Gate: stills are with the user in the workshop. The working surface uses the recommended Ledger; a different pick will be applied to the app, not a new route. Not shipped until the user picks a direction and the applied scope is checked.


## Round 04 — unslop pass

Time: 12:40–13:45 America/New_York. Usage not readable.
Skill: unslop by Damir Sokolovsky (CC BY 4.0). Direction: exact, quiet, workbench-warm; a drafting desk with warm paper, brass instruments and one dark terminal; the output deck is the moment, the newest line carries a brass rule, and a 6px port light is the signature.

Audit and fixes, in the skill's nine passes: spacing to a 4px rhythm; neutral surfaces for banners and selected controls with amber left only where it means something; one 14px/1.75 icon set; sentence-case labels and copy without trailing periods; 11.5–12px minimum meta; quiet dot-and-text statuses instead of pills; quiet counts instead of chips; the newest output line marked; looping pulses removed. Full report: `artifacts/processes-workshop/UNSLOP.md`.

Measured after the pass: no computed text under 11px and no uppercase inside the Processes surface; all icons 14×14 at 1.75 stroke; no CSS animations; no sideways scroll at 600/1440; light and dark render; workshop `tools/check.mjs` all pass; app typecheck, lint, build and 600 unit tests (1 skip) pass; scripted browser loop (search → mark good → stop → stop all → empty) passes.
Still not met: the user has not picked a direction; the working surface stays Ledger. Deferred: collapsing the right pane on narrow Processes, a details disclosure on narrow, and the in-conversation processes button.


## Round 05 — review feedback: the list and the inline chips

Time: 14:05–15:10 America/New_York.
User feedback: "the stuff in this area still looks super sloppy" on the Ledger list; "i want that inline button to be kinda popped out 3d look".

Root cause found: the mock's `.mock button` reset (`.mock` class + element) outranked every component button class, so row padding and chip borders/surfaces were being stripped. The reset is now `:where(.mock button)` (zero specificity), and every component's intended padding, border and surface applies. The list was then rebuilt on the fixed base.

List: 54–56px rows; conversation labels with no icon and the agent only; name / address / status in a two-line grid; status at the opposite end from the address; icon-only Open on live rows; a neutral selected surface with a hairline; group rules; a single-line check reminder with a brass dot. The same anatomy now ships in the app.

Inline chips: a command keycap (3D: paper surface, top highlight, 3px bottom lip, offset shadow, presses down) and an address link under the agent's reply. Stopped/failed starts and opens; running opens Processes and the address opens the site; unverified opens Processes. Added to the app (`ConversationProcesses.tsx`) and the Option 2 mock plus a close-up.

Measured: clicking `npm run dev` created `127.0.0.1:5188` and navigated the Browser pane to the running port; the address chip only appears when running. Workshop `tools/check.mjs` all pass; app typecheck, lint and build pass; 600 unit tests (1 platform skip) pass. Screenshots: `stills/app/processes-list.png`, `stills/app/processes-conversation.png`, `stills/app/processes-conversation-dark.png`; workshop `stills/workshop/O1-ledger.png`, `O2-rail.png`.


## Round 06 — chosen: Option 2, Rail

Decision: use the Rail. Processes becomes a right-pane tab beside Activity, Diff, Browser and Terminal. The project Processes section tab and its route are removed; the project tab row stays Conversations, Files, Workflows, Skills. The Ledger page's row anatomy and list logic moved into the compact pane.

Changes: `ProcessesPane` (search, conversation groups, 48–56px rows, expandable address/command/folder/output, Open, Stop, Mark as good, Stop all), right tab with a live count, `ade:processes-open` event so a running inline chip brings the tab forward. The expanded log has **Follow latest**: it follows while at the bottom, shows **Scrolled back** after you scroll up, and the button returns to the tail. The inline command keycap and address link remain.

Verified: section tabs no longer include Processes; right pane opens and has 3 rows; Follow latest pauses and resumes; an inline chip brings the tab forward; 600/1024 layouts do not overflow; legacy `/processes` opens the pane; typecheck, lint and build pass.

## Round 07 — ADE's own rows

Review asked whether ADE can see itself while working on the ADE project. Implemented the defaults: this window plus a terminal-started ADE dev server for the same project. Both are read-only Open rows in a pinned ADE group at the top of Processes, visible only when the active project is the checkout the server runs from.

Backend: `isAdeProjectPath` compares the project with the server's cwd; `findUnmanagedAdeInstances` scans loopback HTML servers, requires an ADE title and a `/api/bootstrap` response whose workspace contains this project, excludes the current and managed ports, and caches for 5s. This server exposes its own address/port. The list response carries `ade: { app, unmanaged }`; the pane renders it before conversation groups. Stop all and the tab count exclude these rows.

Verified with a second ADE on 3102: it appeared as **ADE dev server · Unmanaged**, and disappeared after it stopped and the cache expired. Current window showed `http://127.0.0.1:3101` as **This app**. Unit tests cover path matching, project matching and failed scans; the process tests assert `ade: null` for a temp project. Typecheck, lint and build pass.


## Round 08 — the stale tab

The review screenshot showed the old full-page Processes tab beside Skills and
"Failed to fetch". The source no longer has that tab or page; the tab was an old bundle
whose server had stopped, so its API calls failed.

Added `p.$projectId.processes.tsx` as a redirect to the project's Conversations with
`pane=processes`, so the old URL now lands in the right-pane rail. Restarted ADE from
this checkout on 3100 with the real workspace. Verified: the old URL redirects, the
section tabs read Conversations / Files / Workflows / Skills, the Processes tab is in
the right pane, and "Failed to fetch" is gone. The current workspace has only spec-flow,
so the pinned ADE group is correctly absent there; it appears when the ADE checkout
itself is the active project.


## Round 09 — ADE's own tab beside Skills

Review: "maybe we do need the processes beside skills for ade specific processes."

The ADE rows moved out of the agent pane and onto a conditional **Processes project tab** beside Skills. The tab and its page exist only when `appProjectId` matches the open project; `appProjectId` is the checkout the server runs from, added to bootstrap. The page lists **ADE · This app** and **ADE dev server · Unmanaged** as read-only Open rows, with an **Agent processes** action that opens the right-pane tab. The pane is now agent-only; its count and Stop all never include ADE. Non-ADE projects keep four project tabs, and `/p/<project>/processes` there redirects to Conversations with the pane; the legacy `/processes` opens the ADE page in the ADE checkout and the pane elsewhere. The page is vertically composed rather than a short strip at the top.

Verified: ADE checkout tabs read Conversations / Files / Workflows / Skills / Processes; page renders one This app row and an Agent processes action that opens the pane; the pane has no ADE rows; spec-flow has no Processes tab and its old URL redirects to the pane; `/processes` resolves correctly in both. Typecheck, lint and build pass. Screenshots: `stills/app/processes-ade-page.png`, `stills/app/processes-pane-agent-only.png`, `stills/app/processes-specflow-fixed.png`.


## Round 10 — ADE's tab in every project

Review screenshot: spec-flow, no Processes beside Skills. The tab was conditional on the
open project being the ADE checkout, so a normal project correctly hid it. The intent was
ADE's own processes in **every** project, not only while dogfooding ADE.

Changed: the **Processes** project tab beside Skills is now unconditional; its page is the
same ADE page in every project (This app + unmanaged ADE servers sharing the ADE checkout,
read-only). The backend returns `ade` for every project; unmanaged detection needs the ADE
checkout added, otherwise This app still shows. The right-pane Processes tab remains
agent-only. Removed the now-unused `appProjectId` bootstrap field. `/processes` always opens
the ADE page in the last project. Removed SectionTabs' route preloads, which raced the
legacy redirect and logged a `_nonReactive` router error; the direct page is clean and the
redirect is clean.

Verified: spec-flow shows Conversations / Files / Workflows / Skills / Processes; the ADE
page shows This app at 127.0.0.1:3100; the right-pane tab stays available for agent
processes; `/processes` resolves to the page; no console errors. Typecheck and build pass.
