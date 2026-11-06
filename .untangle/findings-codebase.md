# Codebase findings

The findings below record the initial survey and its end state. “Resolved” means the coupling
or special case was removed or represented by a shared contract. “Retained” means the behavior
still has an external requirement and should remain explicit.

## Hidden links

- **Resolved — pane navigation.** Shell, tabs, rail selection, URL parsing, and the floating
  browser had separate tab/path knowledge. `navigation.ts` and `rightPaneTabs.ts` now own the
  shared tab and project-path contracts; mini-player selection follows Shell's selection path.
- **Resolved — folder and file state.** The hidden-file toggle returned to home, and file edits
  were mirrored across component state, drafts, and query cache. Folder browsing retains its
  current path, and file content/drafts now have one shared reactive source.
- **Resolved — browser protocol and lifecycle.** Stream paths, viewport/input limits, and button
  masks now live in shared contracts; unused parallel resize and WebSocket control paths are
  removed. Attach looks up an existing session and sends its current dialog and file chooser.
  Held input release has one awaited path, and a closed browser has its own error code.
- **Resolved — tool, project-script, and dev-process contracts.** Schemas are separated from
  dispatch, tool action names cannot be overwritten by arguments, session turns use the command
  produced by project checks, and routes use dev-server lifecycle methods rather than child maps.
  A tool-dispatch invariant now covers every advertised tool.
- **Resolved — runtime and package metadata.** The Node floor and port come from shared runtime
  metadata; packaging has one content list and import discovery follows the source AST.
- **Resolved — project and right-pane routing.** URL project parsing, project selection, tab
  ids, and route-first active-project setup had independent implementations. Shared helpers now
  own those contracts, and a direct project URL initializes the browser with that project.
- **Resolved — browser presentation state.** Placement/mini-player geometry and high-churn frame
  state are separate from browser session state, so unrelated consumers do not subscribe to frame
  updates.

## Needless links

- **Resolved — dependency direction.** Query code no longer imports editor APIs from components;
  APIs and editor icons live in library/files modules.
- **Resolved — display modules as metadata sources.** The rail no longer imports tab metadata
  from the tab-rendering component.
- **Resolved — low-value shims and parameters.** Removed the unused HostEditorPane re-export,
  `projectConversationsPath`, unused tab `actions` prop, redundant expand icon alias, and dead
  panel identifiers/branches.
- **Resolved — protocol and route internals.** Browser control/resize branches that had no caller
  were removed; dev routes no longer mutate process maps or stop child processes directly.
- **Resolved — transport-specific approval cancellation.** Approval waits accept an AbortSignal;
  `http.mjs` adapts response closure into cancellation instead of passing raw HTTP responses to
  the approval service.
- **Retained — route composition.** `ade-local.mjs` still assembles shared services into a
  request context. It is the composition root; narrowing each route to a private context would add
  parameter plumbing without moving ownership of mutable state.

## Surplus

- **Removed.** Dead HostEditorPane/editorApi component shim, unused navigation helper and tab
  props, unused browser sandbox signature, no-op resize/control protocol, duplicate owner check,
  dead host-editor styles, and unused Shell panel variants.
- **Removed or rewritten.** Fixed-delay race tests were replaced with observable barriers where
  time itself was not the behavior. The malformed/oversized stream test now takes control before
  sending invalid input. Initial dialog/file chooser and full tool dispatch have behavior checks.
- **Retained.** Browser idle timeout, terminal process handling, and platform-only skips remain
  covered because their timing/platform behavior is part of the contract.

## Special cases

- **Resolved.** Mini-player selection now expands/selects through the same path as the pane; folder
  picker toggles preserve the current directory; stream attach no longer creates a browser and
  reports already-open modal state; closed-browser errors are distinct from human control.
- **Resolved.** The cross-transport held-key cleanup mismatch is replaced with one awaited release
  operation. Computer/tool actions and schemas have a dispatch test, and an input-spread bug no
  longer lets arguments override the chosen action.
- **Retained — browser/CDP timing.** Screencast pacing, navigation polling, cursor timing, and
  bounded CDP fallbacks remain because browser events do not provide an equivalent settled signal
  in every supported path. Failures that affect optional capabilities remain best-effort.
- **Retained — dev-server readiness.** Port allocation and bounded connection polling account for
  WSL's delayed loopback socket release and verify that a child really listens before reporting
  “running.” These are documented lifecycle requirements, not arbitrary sleeps.
- **Retained — approvals and transport response mapping.** The project-scoped start route owns the
  HTTP response vocabulary for approval, timeout, denial, and concurrent starts. Process creation,
  child ownership, refresh, and stop mechanics live behind `createDevServers`; moving the route's
  response decisions into that service would couple it to HTTP contracts rather than remove a
  change-together relationship.
- **Retained — storage and DOM lifecycle.** Local storage remains optional, with failures ignored
  so the UI works without persistence. Persistent pane DOM reparenting and folder-picker Escape
  handling preserve SSR, dock state, and dialog keyboard behavior.
- **Retained — computer-state polling.** The computer service exposes no transition event stream;
  the one-second status fingerprint remains the current invalidation signal.
- **Retained — setup/runtime boundaries.** Host browser installation has OS, package-manager,
  root, sandbox, and architecture branches; the Node gate runs before importing Node-only code.
  Local CLI, npm start, Vite, and Lovable's hosted server remain separate real entrypoints.

## Follow-up decisions

- The remaining dev-start route orchestration, broad composition context, computer status poll,
  browser/CDP timing, and separate launch entrypoints were reviewed after implementation. Each
  represents an existing API, lifecycle, or platform contract; no further relocation would reduce
  the set of changes required for a behavior change.
- Tool schema/dispatcher drift is guarded by a test that invokes every advertised tool and checks
  its route. Keep the two modules separate: schema definitions are imported by adapters that do
  not need HTTP/MCP dispatch code.
