# Agent picker visual harness

From the project root, run:

```sh
node cook/harness/capture.mjs
```

The script starts its own Vite server on `127.0.0.1:6198`, renders the production `AgentPicker` using the project's dark stylesheet, and writes `cook/stills/r01/R01.png`, `R02.png`, and `R03.png`. Set `COOK_ROUND=r02` (or another round number) for a new output directory, `COOK_PORT` if the port is taken, or `CHROMIUM_PATH` if Chromium is installed somewhere other than `/usr/bin/chromium`.

The fixtures in `store.ts` imitate the Claude, Codex, and OpenCode lists in the supplied references. The screenshots use their respective native viewport dimensions: 1302 × 489, 1171 × 535, and 1060 × 455. Re-run after changes to the picker; editing fixtures in `store.ts` changes the simulated capabilities and agents. To view interactively, run `node node_modules/vite/bin/vite.js --config cook/harness/vite.config.mjs --port 6198` and open `/cook/harness/index.html?agent=claude` (also `codex` or `opencode`).

This harness exercises picker rendering and selection state, not the server, CLI discovery, usage limits, updater, sign-in, or install dialogs; dialog modules are intentionally stubbed. The surrounding background is ADE's own dark theme, not the reference wallpaper or composer. Captures move the picker upward if needed to fit; if it is taller than the viewport, they uniformly scale it down to fit. The capabilities shown are fixture data, not a claim that these model IDs or permissions exist in the user's environment.

For a coarse color check (ImageMagick required):

```sh
python cook/harness/color-check.py REFERENCE.png cook/stills/r01/R01.png
```

Differences include the deliberately different surrounding background; do not interpret them as picker-only similarity scores.
