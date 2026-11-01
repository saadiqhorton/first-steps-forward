# 0003: Push invalidations and keep session logs out of the workspace file

**Status:** accepted, 2026-10-31.

## Context

The browser fetched the full workspace every two seconds. Each response included every session's
messages and recent CLI logs, and the server also refreshed Git state during those requests.
Every turn log line therefore grew and rewrote `~/.ade/workspace.json`, even when the UI only
needed a status badge or conversation title.

## Decision

Bootstrap returns project and session summaries. A selected session loads its messages, checks,
manifest, and change details from `GET /api/sessions/:id`; its activity log is read separately
from `GET /api/sessions/:id/logs?after=<n>`. Session logs are append-only JSONL files in
`~/.ade/session-logs/`, with a bounded in-memory tail, private file permissions, and compaction
after the retained 500-line window is exceeded. Older `session.logs` arrays migrate on load.

The app keeps bootstrap and session data in React Query. One guarded Server-Sent Events connection
sends versioned scope invalidations (`bootstrap`, `session:<id>`, `logs:<id>`, and related live
scopes); clients refetch only affected queries. Events are coalesced, and a 15-second foreground
refetch is used if EventSource is unavailable or cannot establish a ready stream. Git refresh runs
on a server timer only while an event client is connected, and immediately after a turn ends.

## Consequences

- Idle clients no longer download conversation history and activity output on every refresh.
- The workspace file contains durable session state without the high-volume CLI log stream; log
  files can be tailed incrementally and compacted independently.
- Summary and detail queries have separate lifetimes. Views that need messages or logs must load
  those resources explicitly.
- Push delivery depends on an unbuffered stream through the local server or proxy. The ready event
  detects a missing stream, and the fallback keeps the UI current at a lower rate.
- A legacy workspace migrates its embedded logs on startup; subsequent writes use the per-session
  JSONL files.
