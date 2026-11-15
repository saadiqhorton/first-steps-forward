# Unslop pass: ADE Processes

Run with the [unslop](https://github.com/heydamir/unslop) skill by Damir Sokolovsky (CC BY 4.0).

## Direction

- **Product.** A local workspace where one developer runs coding agents and keeps the servers and watchers they leave running in view.
- **Character.** Exact, quiet, workbench-warm.
- **World.** A drafting desk: warm paper, brass instruments, one dark glass terminal.
- **Moments.** The process output as a dark deck, with the newest line marked by a brass rule.
- **Signature.** A 6px port light before every process, and one brass rule on the live tail.

The ADE palette, type and layout stay. This is a polish pass, not a redesign.

## Audit, before

- Uppercase tracked labels: `PROCESS DETAILS`, `FOLLOWING LOG`, `OPTION`, `SCENARIO`, `THEME`, `OUTPUT`, `RECOMMENDATION`, close-up captions, table headers.
- Text under 11px: 9.5–10.5px in rows, tables, card peeks, footers and output bars.
- Amber on everything: every selected segment, the tab count, the check banner, the wrap toggle, the count badge. The page read as amber on beige.
- Pills for status and counts, with borders and fills.
- Looping pulse on starting/stopping dots and the mock wait dot.
- Icons at 10, 11, 12, 14 and 16px with stroke 2, nudged off the label column.
- Copy: `Search processes…`; trailing periods on short strings (`Nothing running yet.`, `Address copied.`); `Stop all processes…`; `Wrap output lines`.
- Spacing one-offs: 22px grid gap, 14px control padding, 18px brief gap, 10px group padding; rows with uneven heights.
- The dark output box had no moment of its own; it was just a black panel.
- `Needs checking` repeated in the title and immediately again in the banner; the empty state appeared twice.

## Passes

1. **Spacing.** 4px rhythm through the list, detail, table and cards: 8/12/16/20/24, one row height, one padding per card, 16px between groups and 8px inside them.
2. **Color.** Banners and selected segments became neutral surfaces with hairlines. Amber is now reserved for meaning: a live count, `Needs checking`, the newest line, and the active option marker.
3. **Icons.** One 14px lucide set at 1.75 stroke, an 8px gap to labels, a single 16px terminal in the empty state.
4. **Copy.** `Search`, `Wrap lines`, `Stop all`, `Nothing running yet`; short strings lost their periods; the banner lost its duplicate `Needs checking`.
5. **Type.** Sentence case everywhere; 11.5–12px minimum for meta; mono only for figures, addresses and commands; tabular line counts; no negative tracking on small text.
6. **Layout.** Unchanged. The Ledger, the right-pane rail, the console and the cards keep their shapes and proportions.
7. **Details.** Status is a dot plus text, not a pill. Counts are quiet mono text. `Needs checking` and `Couldn't stop` use a 2px brass or danger rule instead of a tinted block. The active row is a neutral surface step.
8. **Visuals.** The output deck is the one rich surface; its newest line carries a 2px brass rule, so the live tail is visible without animation. No generated image belongs in this app screen.
9. **Motion.** Removed the looping pulse on starting/stopping and wait dots. Kept 120ms color transitions, the 160ms sheet entrance and the toast rise, all on one ease-out curve.

## Checked

- No computed text below 11px and no `text-transform: uppercase` inside the Processes surface.
- Every icon is 14×14 with a 1.75 stroke; the empty state uses one 16px icon.
- No CSS animations on the surface; no sideways scroll at 600px or 1440px.
- Light and dark render; the workshop check passes every option and interaction.
- App: typecheck, lint, build, 600 unit tests (1 platform skip), and the scripted browser loop (search → mark good → stop → stop all → empty).

## Follow-up from review

**Feedback.** The process list in Ledger still looked sloppy, and the inline process chip should read as a popped-out 3D control.

**Root cause.** The mock's `.mock button` reset outranked every component button class, so rows lost their horizontal padding and chips lost their border and surface. The reset is now `:where(.mock button)`, which has zero specificity, so a component's own padding, border and surface win. That one fix restored the list and the chips; the list was then redesigned on top of it.

**List.** One row shape, 54 to 56px: name on the first line, address and status at opposite ends of the second, a 6px port light at the left, an icon-only Open on live rows, and a neutral surface with a hairline for the selection. Group labels lost the speech-bubble icon and the age: they are the conversation name, with the agent quietly at the right, separated by a rule. The check reminder is a single line with a brass dot, not a card.

**Inline chips.** Under the agent's reply: a command keycap (paper surface, top highlight, 3px bottom lip, offset shadow, presses down on use) and a quiet address link. Stopped or failed: Play, starts the process and opens its address once it is up. Running: Terminal, opens the process in Processes. Unverified: Terminal, opens Processes to check. The address link opens the site in ADE's browser.

**Measured.** Clicking `npm run dev` created the address chip `127.0.0.1:5188` and navigated the browser to the new port. The list and chips render in light and dark; the workshop check passes; typecheck, lint and build pass.

## ADE's own rows

Once the chosen Rail shipped, the review asked whether ADE could see itself while
working on the ADE project. ADE's own rows now live on a **Processes project tab**
beside Skills in every project: this window as **This app**, and any unmanaged ADE
server on loopback that shares the ADE checkout. Both are read-only Open
links. The right-pane Processes tab is for agent servers and watchers and no longer
mixes ADE's rows into its count or Stop all. Detection is cached, and an installed ADE
started from another folder does not show the tab. The mock in Option 2 shows the
project tab beside Skills.

## Not applied

- Collapsing ADE's right pane automatically on Processes at narrow widths; the section scrolls instead.
- Moving process details into a disclosure on narrow screens.
- The in-conversation processes button from Enjoy; not part of this pass.
