# Skills workspace workshop: option contract

A static comparison page for the new **Skills** project section in ADE.
`index.html` loads `workshop.js`, then `options/*.js`, and each option file calls `WS.register({...})`.

The workspace follows the [Agent Skills](https://agentskills.io/home) format: a skill is a
directory with a `SKILL.md` whose YAML frontmatter carries `name` and `description`
(required) plus optional `license`, `compatibility`, `metadata` and `allowed-tools`, and the
folder may bundle `scripts/`, `references/`, `assets/` and anything else.

Three scopes are in play:

| Scope | Path | Who owns it |
| - | - | - |
| ADE | `~/.ade/skills` | ADE's own, self-contained set in its data dir — yours to edit |
| Project | `.agents/skills` | Found in the repository. Read-only, and hidden until you ask for it |
| User | `~/.agents/skills` | Shared with the other agent clients on this machine |

## What an option file registers

```js
WS.register({
  id: 1,                       // fixed number; never change it
  name: "Gallery + drawer",    // 1–3 words
  tradeoff: "One sentence: what it gains and what it costs.",
  notes: ["3–5 short bullets on how it behaves (HTML allowed)", "...", "Include one bullet: what changes in the real code"],
  css: `/* every selector scoped under .opt-1 */`,
  initialState() { return { /* this option's own state */ }; },
  mount(root, ctx) { /* the whole workspace mock */ return { update(state) {}, destroy() {} }; },
  closeups: [{ label: "Import dialog", mount(root, ctx) { /* one control, close up */ } }],
});
```

- `root` has the classes `mock opt-N` and `data-mock-theme`. It is a flex column with `overflow: hidden`.
  - The full mount is 1280 × 720.
  - A close-up mount fills a 360 × 460 box.
- `ctx.getState()` / `ctx.setState(partial)` hold this option's isolated state. `setState` re-renders
  every mounted instance of the option; `ctx.patch(partial)` updates the state without re-rendering
  (use it for keystrokes, so the caret stays in the field).
- `ctx.report(text)`: a one-line readout above the stage.
- `ctx.kind`: `"full" | "thumb" | "closeup"`.
- `ctx.mock`: shared sample content, so every option shows the same data.
  - `ctx.mock.chrome()`: the ADE top bar and the project section tabs (Conversations, Files, Workflows, **Skills**).
  - `ctx.mock.initialSkills()`: the sample library — ADE's own skills, the project's skills, and a user skill.
- `ctx.mock.scopes`: the three scopes, with their path and a one-line hint.
- `ctx.mock.visibleSkills(library, detectProject)` / `ctx.mock.hiddenProjectSkills(library, detectProject)`:
  project skills stay out of the list until the user asks for them.
- `ctx.mock.fileKind(path)` / `ctx.mock.bundledKinds(skill)`: what a skill bundles — instructions,
  references, scripts, assets, agent config, other.
  - `ctx.mock.packages`: the three packages the Import control can hand over —
    `packaged` (a `.skill` file with one skill), `zip` (a `.zip` with three skills, one of them
    with a name that does not match its folder), and `invalid` (a `.zip` with no `SKILL.md`).
  - `ctx.mock.importInto(library, pkg, scopeId)`: merges a staged package into a library.
  - `ctx.mock.validateName(name)` / `ctx.mock.validateDescription(description)`: the format rules.
  - `ctx.mock.fileRow(file)`: one bundled-file row, with the kind of the file.
- `ctx.icons`: lucide SVG strings, 16px, `class="i"`.

## Shared CSS (shared.css)

- Tokens on `.mock`: `--ink --paper --panel --amber --amber-deep --teal --line --dim --danger --deck
  --deck-foreground --surface-muted --surface-raised --scrim --shadow-floating --radius-control
  --radius-panel --font-display --font-sans --font-mono`. They switch for dark and light.
- Classes: `.m-btn-amber`, `.m-btn-quiet`, `.m-btn`, `.m-card`, `.m-label-mono`, `.m-truncate`,
  `.m-pill`, `.m-scroll`, `.m-input`, `.m-textarea`, `.m-field-label`, `.m-scrim`, `.m-dialog`,
  `.m-notice`, `.m-empty`, `.m-topbar`, `.m-sections`.

## Rules

- Match ADE's visual language: warm paper/panel neutrals, amber accent, Geist display, Inter body,
  IBM Plex Mono labels, 1px `--line` borders, rounded cards. Don't invent a new palette.
- Use real `<button type="button">` elements with visible focus. Give every focusable element a
  `data-focus` key so `WS.renderKeepFocus` can restore focus after a re-render.
- Respect `prefers-reduced-motion`. Animations are short (≤200ms) and CSS-only.
- Scope every CSS selector under `.opt-N`. Don't touch `shared.css`, `workshop.js`, `index.html`, or
  another option's file. Write only your own `options/option-N.js`.
- Plain browser JS (no modules, no imports, no build step).

## Checking the page

```bash
node tools/check.mjs
```

Serves the folder, loads every option, runs the import → create → edit → remove loop inside the
mock, checks that project skills stay hidden until they are asked for, that reset clears the
library, and that keyboard focus survives a re-render. Screenshots land in `shots/`.
