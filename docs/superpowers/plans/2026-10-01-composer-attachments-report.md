# Composer attachments implementation report

**Date:** 2026-10-01

## Status

DONE

## Files created

- `src/local/attachments.mjs`
- `src/local/attachments.test.mjs`
- `src/local/ade-local.attachments.test.mjs`
- `src/components/ade/ComposerAttachments.tsx`

## Files modified

- `src/local/ade-local.mjs` — attachment routes, session wiring, 14 MiB upload cap, binary GET, `runAgent` / `agentCommand` attachment threading, queue comment
- `src/local/adapters/codex.mjs`, `opencode.mjs`, `pi.mjs` — native CLI flags
- `src/local/adapters/adapters.test.mjs` — attachment argv tests
- `src/lib/ade/types.ts` — `MessageAttachment`, `Message.attachments`
- `src/lib/ade/store.tsx` — `uploadAttachment`, `startTask` / `steer` `attachmentIds`
- `src/components/ade/Composer.tsx` — drafts, paste/drop, paperclip, send signature
- `src/components/ade/NewTaskForm.tsx`, `SessionView.tsx`, `SessionMessage.tsx`
- `package.json` — test script includes new test files

## Tests run

| Command | Result |
|---------|--------|
| `node --test src/local/attachments.test.mjs src/local/ade-local.attachments.test.mjs src/local/adapters/adapters.test.mjs` | 25/25 pass |
| `npx tsc --noEmit` | pass |
| `npm test` | 133/133 pass (after one flaky retry on unrelated terminal test) |
| `eslint --fix` on changed TS/JS | pass (one pre-existing react-refresh warning on `ComposerAttachments.tsx` for exporting `formatAttachmentSize`) |

## Concerns / deviations

- None architectural. Queued follow-ups intentionally omit native `--image`/`--file` flags (path appendix only), as specified.
- `ComposerAttachments.tsx` exports `formatAttachmentSize` for `SessionMessage`; ESLint warns about fast-refresh mixed exports (cosmetic).
