# Responsive panels workshop: option contract

This is a static comparison page. `index.html` loads `workshop.js`, then `options/*.js`, and each option file calls `WS.register({...})`.
Read `options/baseline.js` first. It reproduces today's broken behaviour and is the reference implementation of this contract.

## What an option file registers

```js
WS.register({
  id: 3,                       // fixed number; never change it
  name: "Snap sizes",          // 1–3 words
  tradeoff: "One sentence: what it gains and what it costs.",
  notes: ["3–5 short bullets on how it behaves (HTML allowed)", "...", "Include one bullet: what changes in the real code"],
  css: `/* every selector scoped under .opt-3 */`,
  mount(root, ctx)      { /* full mock workspace */ return { update(state) {}, destroy() {} }; },
  mountPanel(root, ctx) { /* right panel only, fills root (240/320/480px close-ups) */ return { update, destroy }; },
});
```

- `root` already has the classes `mock opt-N` and `data-mock-theme`. It is a flex column with `overflow: hidden`.
  - The full mount is `state.viewport` px wide and 680px tall.
  - The panel mount is fixed at 240, 320 or 480px wide and 460px tall.
- `ctx.getState()` / `ctx.setState(partial)`: this option's isolated state. `setState` calls `update(state)` on every mounted instance of this option.
  - State fields: `{ viewport: 768|1024|1280|1600, rightWidth: px requested by the user (slider/sash, 0..viewport), computer: "off"|"starting"|"live"|"error", tab: "activity"|"diff"|"computer"|"terminal", mockTheme, rightOpen: boolean }`.
  - You may add your own keys, such as `drawerOpen` or `docked`. Reset clears them.
- `ctx.attachSash(el, { side: "right", onEnd(state) })`: makes `el` a draggable, keyboard-resizable seam that writes `rightWidth`. Use `onEnd` for snapping on release.
  - `rightWidth` is the user's *request*. Your option decides the rendered width (clamp, snap, collapse, dock…).
- `ctx.report(text)`: a one-line readout above the stage, e.g. `"Right panel 280px · compact"`. Call it in `update`.
- `ctx.kind`: `"full" | "panel" | "thumb"`. In `thumb` mode, `setState` does nothing.
- `ctx.mock`: shared sample content builders. **Use them so the content is identical across options.**
  - Chrome: `topBar()`, `sectionTabs()`, `mainPanel({withList})`, `conversationList()`, `newTask()`.
  - Tab bodies: `activityBody()`, `diffBody()`, `terminalBody()`, `liveScreen()`.
  - Computer status: `statusPill(computer)`, `detailsRows()`.
  - Data: `computerCopy[state]` = `{title, description, badge, tone, footerLeft, footerRight, action, hint}`, `rightTabs` = `[{id,label,icon}]`, `project`, `details`.
- `ctx.icons`: lucide SVG strings (`monitor, play, branch, paperclip, arrowUp, terminal, activity, diff, x, panelClose, panelOpen, settings, moon, loader, chevronDown, expand, plus, more, check, file`). Each is `<svg class="i">`, 16px. Resize it with CSS.
- `WS.renderKeepFocus(el, html)`: re-render without losing keyboard focus. Put `data-focus="unique-key"` on focusable elements.

## Shared CSS available (shared.css)

- Tokens on `.mock`: `--ink --paper --panel --amber --amber-deep --teal --line --dim --danger --deck --deck-foreground --surface-muted --surface-raised --scrim --shadow-floating --radius-control --radius-panel --font-display --font-sans --font-mono`. They switch automatically for dark and light.
- Classes:
  - `.m-btn-amber`, `.m-btn-quiet`, `.m-card`, `.m-label-mono`, `.m-truncate`, `.m-pill`, `.m-scroll`.
  - `.m-right`: a container-query root named `right`, so use `@container right (max-width: 300px) { … }`.
  - `.m-task`: a container named `task`.
  - `.m-seam`, `.m-body`, `.m-mainpanel`, `.m-conv` (240px conversation list), `.m-screen` (16:10 live screen box).
- The main panel's New Task view already responds to its own width (auto-fill card grid, wrapping composer, padding). Don't restyle it unless your direction changes the main panel's behaviour.

## Rules

- Match ADE's visual language: warm paper/panel neutrals, amber accent, Geist display, Inter body, IBM Plex Mono labels, 1px `--line` borders, and rounded cards on `--radius-panel`. Don't invent a new palette.
- Keep today's product behaviour and copy. The right panel still has Activity / Diff / Computer / Terminal. The Computer tab still has a header with the project name and status pill, the screen or card, the hint, the actions when live (Take control, Full screen, Turn off), and the Details rows (Checks, Working tree diff, Agent output).
- Clicking a tab must switch `state.tab`. A Start button sets `computer: "starting"`, and Turn off sets `"off"`. These are mock outcomes only.
- Nothing may be clipped or overlap at any width from 240px to 900px, or at any window width (768, 1024, 1280, 1600). Text truncates with an ellipsis or wraps. The Start computer button is always visible in the off and error states.
- Use real `<button type="button">` elements for controls, with visible focus. Respect `prefers-reduced-motion`. Animations are short (≤200ms) and CSS-only.
- Scope every CSS selector under `.opt-N`. Don't touch `shared.css`, `workshop.js`, `index.html`, or another option's file. Write only your own `options/option-N.js`.
- Plain browser JS (no modules, no imports, no build step). Each option file is self-contained and shouldn't exceed about 450 lines.
- In `mount`, clean up listeners in `destroy()`. Avoid `setInterval`. If you use a `setTimeout`, clear it in `destroy`.
