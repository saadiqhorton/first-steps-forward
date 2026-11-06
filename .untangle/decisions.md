# Untangle decisions

## Findings-to-fix map

- Define pane tabs and project URL parsing in navigation metadata, not in display components.
  Use one selection path so pane selection, expansion, and mini-player behavior stay aligned.
- Keep folder location and file drafts as explicit shared state. Refresh the active folder when
  visibility changes; do not mirror edited file text in a component and the query cache.
- Treat the browser preview as a session with an existing-session attach, complete initial
  snapshot, explicit close/control errors, and one held-input release path. Keep stream limits in
  shared contracts; remove unused protocol branches. Separate frame updates and presentation
  placement from session actions/state.
- Separate tool schemas from dispatch and make the selected action authoritative. Verify every
  advertised tool reaches a matching route.
- Put dev child ownership, process records, start claims, refresh, and stop operations behind
  `createDevServers`. Keep HTTP response wording and approval outcomes in the route adapter.
- Accept cancellation as an approval-service signal, with HTTP disconnect handling isolated in
  the HTTP adapter.
- Put API code and shared runtime/package contracts below UI and entrypoint consumers. Derive
  runtime metadata and generated package contents from a single source.
- Remove confirmed dead shims, props, aliases, protocol branches, panel variants, and CSS.
- Remove comments that restated the next operation; keep external behavior and platform
  constraints. Replace tests that could pass because of an unrelated guard with behavioral
  coverage and observable synchronization.

## End state

- Implemented the shared navigation, runtime, browser, and packaging contracts; folder/file state
  ownership; browser lifecycle and presentation boundaries; tool dispatch separation; dev-server
  lifecycle encapsulation; and component-to-library dependency cleanup.
- Removed confirmed surplus and cleaned implementation-restating comments.
- Reworked timing-sensitive assertions where the wait was not itself the contract. Retained tests
  for idle timeout and process timing where timing is the behavior.
- Added checks for already-open dialog and file chooser state, malformed input after control is
  acquired, closed-browser errors, tool action safety, and dispatchability of every advertised
  tool.
- Reviewed remaining special cases with three Luna audit agents. Retained platform, browser/CDP,
  readiness, approval-response, storage, and DOM-lifecycle behavior because those encode current
  external contracts. Full findings and rationale are in `findings-codebase.md`.

## Verification

- `npm test`: 472 passed, 1 platform-specific test skipped, 0 failures. An earlier run overlapped
  two builds and caused a dev-server fixture to report stopped; the isolated dev-command suite
  passed 10/10 and the sequential full run passed.
- Focused browser/tool tests: 25/25 passed.
- `npm run typecheck`: passed after the browser-context split.
- `npm run build` and `npm run package`: passed sequentially after the browser-context split.
- `npm run lint`: exits successfully with 32 `react-refresh/only-export-components` warnings.
- `git diff --check`: passed after implementation and documentation changes.
