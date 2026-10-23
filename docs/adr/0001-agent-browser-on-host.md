# 0001: The agent computer is headless Chrome on the host, not a Docker desktop

**Status:** accepted, 2026-10-22. Supersedes the "Where the computer runs" decision in
`docs/superpowers/specs/2026-10-01-agent-computer-design.md`.

## Context

The agent computer was one Docker container per project: Xvfb, a window manager, noVNC and a
Python control server around Chromium. It made Docker, a user in the `docker` group and a ~1 GB
image a prerequisite for every `computer_*` and `browser_*` tool, which was the largest setup cost
in ADE. Only Chromium ever ran on that desktop, and the browser layer already worked purely over
CDP, ported from T3 Code's server browser.

## Decision

Follow T3 Code: the agent computer is a headless Chrome on the host, launched by Playwright over a
pipe. ADE installs one pinned Chrome for Testing headless shell into `~/.ade` on first use,
verified by size and SHA-256 (`src/local/browser-install.mjs`); `src/local/browser-contexts.mjs`
owns the launched browser and the per-project profiles; `src/local/browser-host.mjs` and
`npm run browser:setup` explain and fix Linux hosts that block the launch. `computer_*` tools keep
their names and act on the page by coordinates through Playwright. Docker is removed entirely, with
no fallback adapter.

## Consequences

- No prerequisite beyond Node: the browser downloads itself once (~100–120 MB).
- The browser is no longer behind a container wall: it runs as the user, on the host network, with
  Chrome's own sandbox on. The agent CLI already runs that way.
- There is no desktop: anything Chrome draws outside the page (native pickers, menus, its own UI)
  is handled through the page instead, as T3 does: file pickers are intercepted and answered by
  whoever drives, dialogs go through `browser_dialog`, copies reach the viewer's clipboard.
- Pin bumps follow T3's procedure in `browser-install.mjs`: new version, byte counts and SHA-256s.
