# Activity pane: Logs workshop

An interactive comparison of four directions for the **Logs** section of ADE's right-hand
Activity pane (`src/components/ade/ActivityLogs.tsx`, rendered by `ActivityPanel.tsx`).
Nothing in `src/` is touched; this is a standalone design artifact.

## Open it

Open `index.html` in a browser. It is one self-contained file (about 90 KB) that makes no
network requests except Google Fonts (Geist, Inter, IBM Plex Mono, with system fallbacks).

- `index.html` shows a numbered overview of all four options with live thumbnails.
- `index.html#1` to `index.html#4` open an option directly. Previous, Next and Back to
  overview move between views.

## The four directions

| # | Name | Tradeoff |
|---|------|----------|
| 1 | Ledger | Smallest change, full history visible, but a long session is still one long scroll. |
| 2 | Turn disclosures (beUI) | Compact and closest to beUI, but live history is clipped and the shimmer repeats the chat's status line. |
| 3 | Rail | Clearest order and cause→effect, but taller per event. |
| 4 | Outcomes first | Best for non-developers checking results, but the order of steps is hidden until expanded. |

Option 2 follows beUI Agent Activity: shimmering label while a turn runs, a plain summary with a
rotating chevron when it ends, a 208px viewport with an edge-fade mask that glides to keep the
newest row visible, rows that fade and rise in, and trace rows made of an icon, a bold label and a
mono pill with green/rose +N/−N counts. The spring easings are generated from beUI's spring
constants.

## Controls

- **State**: Live streams the run in and holds on the last step; Complete shows the finished
  run; Error is the same run where the last file read fails.
- **Theme**: ADE light or dark, applied to the mock panes only (the workshop chrome uses the host's
  theme variables, with fallbacks).
- **Motion**: Replay, Pause/Resume, speed 0.5x/1x/2x, and a Reduce motion toggle. The system
  `prefers-reduced-motion` setting is honoured automatically (no shimmer, glide or rise).
- **Baseline** (Reset): stops all timers and animations and shows the finished run with every
  disclosure back at its default.

Each option owns its simulation state and timers. Buttons inside a mock pane (for example
"Run project checks") are inert and labelled as mocks; the disclosures inside it work.

## Sample data

The three turns come from `~/.ade/session-logs/7e5e8f2c-…jsonl`, run through
`formatLogLine` in `src/lib/ade/formatLogs.mjs`. Rows are tagged `real` (with the log line number)
or `added` (a plan update, a permission, replies, two shell commands and a successful read, which
that log lacks). Real rows from separate turns are spliced into three turns. The failing read of
`.env` is real. Home paths are shortened and long bodies trimmed. The full table is in the page
under "Sample data".

## Assumptions the mocks make

- Tool names become plain verbs (edit → Edited, read → Read, find → Looked for, bash → Ran,
  dev_server_status → Checked the preview).
- +N/−N counts come from the edit result's `details.diff` in the raw log. The formatter does not
  expose them yet.
- Folding a result into its tool row needs the tool call id, which `formatSessionLogs` drops
  today. In the real log a `find` and a `read` overlap and the read result arrives first, so
  pairing results by position would be wrong.
- Result text is shortened to a plain phrase; reads show no result line.
- The +/− colours are not ADE tokens yet; they match beUI's emerald/rose.

## Decision

Option 2, Turn disclosures (beUI), was chosen on 2026-11-01 and is now in the Logs pane. The
workshop page stays as the record of the options and is not updated.

- `src/components/ade/ActivityLogs.tsx` renders one beUI `AgentActivity` per turn. It takes a
  `live` prop, which `ActivityPanel.tsx` sets while the session is working or verifying.
- `src/lib/ade/activityTurns.mjs` (with `.d.mts` and `.test.mjs`) splits the rows into turns,
  matches each result to its tool call by call id, and writes the plain summary.
- `src/lib/ade/formatLogs.mjs` now gives each row a `kind`, and where the log has them a `callId`
  and +N/−N counts.
- `src/components/agents/`, `src/components/motion/text-shimmer.tsx`, `src/lib/ease.ts` and
  `src/lib/text-shimmer.ts` are beUI's own files (MIT, license in `BEUI-LICENSE`).
