# Untangle decisions (2026-11-08)

Prior Nov 5 pass resolved navigation, folder/file state, early browser contracts, tool
dispatch separation, dev-server lifecycle, and several dependency cleanups. Retained
platform/CDP/WSL/approval/storage/composition-root special cases stay. This pass targets
what the swarm still found wrong—especially post-T3 browser drift and remaining
cross-layer hidden links.

## Findings-to-fix map

- Put viewport acceptance in one shared helper (`viewportAcceptable` / limits from
  `VIEWPORT_LIMITS`) and make every settings UI, client API clamp, and HTTP route use it.
  - `src/lib/ade/browser/api.ts` hardcodes 3840 / 3840×2160
  - `src/components/ade/browser/BrowserChromeRow.tsx` duplicates the same limits + max attrs
  - `src/components/ade/browser/BrowserViewportHandles.tsx` has private MAX_DIMENSION/AREA
  - `src/local/routes/browser.mjs` re-hardcodes the same numbers in the settings route
  - `BrowserSurface.tsx` hardcodes `CTRL_MODIFIER = 2` instead of `MODIFIER_BITS.ctrl`

- Invert lib → UI: Ade data layer must not import NoticeDialog/TokenGate. Mount hosts in
  the app shell; inject warnings into feedback storage.
  - `src/lib/ade/store.tsx` imports and mounts `TokenGate` + `NoticeDialogHost`
  - `src/lib/ade/browser/composerFeedback.ts` and `usePersistentFeedbackList` import `warnUser`
    from a component

- One JSON `request` helper for ADE HTTP; editor and browser clients call it (or a thin
  method wrapper), not three near-copies.
  - `src/lib/ade/api.ts`, `editorApi.ts`, `browser/api.ts` each define fetch+error parsing
  - `HostTerminalPane.tsx` keeps a private fetch stack for `/api/terminal/*`

- Declare model-list completeness on the result (`completeCatalog`) instead of teaching the
  UI that `source === "acp"` means “full catalog / no Other id.”
  - `AgentPicker` / `ModelPicker` / `SessionView` / `NewTaskForm` branch on `source === "acp"`
  - `src/local/models.mjs` already stamps `source: "acp"` for ACP listings

- Keep address normalization with the address contract in `shared`, so shared tests do not
  import `local`.
  - `normalizeBrowserUrl` lives in `src/local/browser-protocol.mjs`
  - `src/shared/browser-address.test.mjs` reaches into local for it

- Extend the shared browser contract with stream message `type` names used by client and
  server, so frame handlers cannot silently drift.
  - `browserStream.ts` ClientMessage/ServerMessage unions vs `browser-stream-server.mjs` switch
  - query params (`recordingFrameRate`, `recordingKeys`, …) remain an undeclared cross-layer API

- Replace per-harness computer wiring forks with one adapter hook shape
  (`wireComputer(ctx) → spawn extras`).
  - `src/local/adapters/computer-tools.mjs` special-cases Codex/OpenCode/Pi/ACP
  - `ComputerContext` always carries both `mcpScript` and `piExtension`; each harness picks

- Leave alone (prior retained / clean seams): `ade-local.mjs` composition root, CDP timing,
  WSL readiness polling, HTTP approval vocabulary in routes, optional localStorage,
  computer status fingerprint poll, multi-entrypoint packaging, `acp.mjs` protocol engine,
  `harness.mjs` job runner, tool schema module kept separate from dispatch (guarded by test).

## End state (this pass)

- Shared viewport helper + MODIFIER_BITS used at every settings/clamp site.
- `AdeProvider` is UI-free; root/shell mounts TokenGate + NoticeDialogHost; feedback warns
  via an injectable notifier.
- Editor/browser/terminal HTTP go through one request path.
- Model listings expose `completeCatalog`; pickers stop encoding ACP.
- `normalizeBrowserUrl` lives under `shared`; local re-exports for old import paths until
  callers move.
- Stream message type constants live in `shared/browser-contract.mjs`.
- Computer wiring is one adapter hook; harness-specific spawn extras stay at the leaf.
- ACP Permission requests stay on `session.pendingPermissions`; Dev command approvals live
  only on `session.pendingDevCommand` / `project.pendingDevCommand`.
- Session pair keys (`sessionPairKey` / `browserScope`) live in `shared/session-scope.mjs`.
- Dual TextShimmer / SCREEN / CONTEXT_VIEWPORT / arc motion-tokens shim removed; Screencast
  and browser dialogs extracted.

## Verification

- Final structure sweep: nothing high-leverage left beyond retained platform special cases
  and intentionally deferred binary/blob fetch helpers.
- `npm run typecheck`: pass.
- Focused demux/persistence/browser tests: pass after fixing save reconcile race that could
  resurrect a settled `pendingDevCommand` from a concurrent stale snapshot.
- Full `npm test` may still flake on browser-annotation integration timeout under load.
