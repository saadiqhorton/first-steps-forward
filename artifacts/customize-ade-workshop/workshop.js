/* Customize ADE workshop: sample data, the shared change engine, shared mock
 * parts, and the comparison shell. Options live in options/*.js and call
 * WS.defineOption().
 *
 * Everything here is a local simulation. No control reaches ADE, a build,
 * git, or the network.
 */
(function () {
  "use strict";

  const svg = (body) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

  // Lucide paths (ADE uses lucide-react), drawn at 1.5 stroke.
  const icons = {
    wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
    inbox: svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    chat: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    list: svg('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
    paperclip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    arrowUp: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
    arrowLeft: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    circleCheck: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    circle: svg('<circle cx="12" cy="12" r="9"/>'),
    circleX: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    loader: svg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),
    alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    globe: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
    external: svg('<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>'),
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
    copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    eye: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
    refresh: svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
    lock: svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a4 4 0 0 1 8 0v4"/>'),
    play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    panelRight: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'),
    square: svg('<rect width="14" height="14" x="5" y="5" rx="2"/>'),
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* ------------------------------------------------------------------ */
  /* Sample data, identical for every option                             */
  /* ------------------------------------------------------------------ */

  const SAMPLE = {
    request: "Add a button to the session header that copies the session's full log.",
    title: "Copy full log button",
    area: "Session header",
    reply:
      'Added a Copy log button next to Stop. It fetches the whole log, not just what\'s on screen, and shows "Copied" when done.',
    genericReply:
      "Done. I made the change in a private copy of ADE and the checks are running.",
    agent: "Claude Code",
    files: [
      { path: "src/components/ade/SessionHeader.tsx", add: 24 },
      { path: "src/local/routes/sessions.mjs", add: 18 },
      { path: "src/local/routes/sessions.test.mjs", add: 41 },
    ],
    checks: [
      { name: "Typecheck", time: "4.1 s", ms: 450 },
      { name: "Lint", time: "2.7 s", ms: 400 },
      { name: "Build", time: "38 s", ms: 750 },
      { name: "Tests", time: "412 passed", failTime: "1 failed", ms: 650 },
      { name: "Design files untouched", time: "No design files changed", ms: 350 },
    ],
    failOutput: [
      ["bad", "✖ sessions.test.mjs › copies the whole log"],
      ["bad", "  expected 1,204 lines, got 200"],
      ["", "ℹ tests 413 · pass 412 · fail 1"],
    ],
    switchSteps: ["Wait for agents to finish", "Save workspace backup", "Restart ADE with your change"],
    removeSteps: "Restarting ADE without it",
    keptFirst: {
      id: "k1",
      title: "Stop dev servers idle for 1 hour",
      area: "Processes",
      when: "Nov 18",
      request: "Stop dev servers that have been idle for an hour.",
      reply:
        "Added a quiet hourly check. Dev servers with no requests for 60 minutes are stopped, and Processes says why.",
      files: [
        { path: "src/local/process-manager.mjs", add: 31 },
        { path: "src/local/process-manager.test.mjs", add: 52 },
      ],
    },
    version: "0.1.15",
    nextVersion: "0.1.16",
  };

  const PHASE_LABEL = {
    building: { label: "Building", tone: "ok", pulse: true },
    checking: { label: "Checking", tone: "ok", pulse: true },
    ready: { label: "Ready to try", tone: "warn" },
    failed: { label: "Checks failed", tone: "bad" },
    switching: { label: "Switching", tone: "ok", pulse: true },
    kept: { label: "Kept", tone: "muted" },
    needs: { label: "Needs you", tone: "warn" },
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  function pendingChecks() {
    return SAMPLE.checks.map((c) => ({ name: c.name, s: "wait", time: "" }));
  }

  /** Fresh state for a scenario. `preset: "ready"` fills a finished change for thumbnails. */
  function freshState(scenario = "ready", extra = {}) {
    const s = {
      scenario,
      mockTheme: "dark",
      width: "desktop",
      criteria: false,
      removed: [],
      setup: scenario === "first" ? "needed" : "done",
      setupPct: 0,
      phase: "idle",
      draft: SAMPLE.request,
      request: "",
      streamPos: 0,
      checks: pendingChecks(),
      previewOpen: false,
      tried: false,
      copied: false,
      switchStep: -1,
      kept: scenario === "first" ? [] : [{ ...SAMPLE.keptFirst }],
      removing: null,
      update: scenario === "carry" ? { kind: "carry", status: "pending" } : scenario === "needs" ? { kind: "needs", status: "pending" } : null,
      version: SAMPLE.version,
      menuOpen: false,
      notice: null,
      ui: {},
      ...extra,
    };
    if (scenario === "fails") s.failTests = true;
    return s;
  }

  function presetReady(s) {
    s.phase = "ready";
    s.request = SAMPLE.request;
    s.streamPos = SAMPLE.reply.length;
    s.checks = SAMPLE.checks.map((c) => ({ name: c.name, s: "pass", time: c.time }));
    return s;
  }

  const allPass = (s) => s.checks.length > 0 && s.checks.every((c) => c.s === "pass");
  const isSample = (s) => s.request === SAMPLE.request;
  const changeTitle = (s) =>
    isSample(s) ? SAMPLE.title : (s.request.length > 44 ? s.request.slice(0, 41).trim() + "…" : s.request).replace(/^./, (c) => c.toUpperCase()).replace(/\.$/, "");
  const replyText = (s) => (isSample(s) ? SAMPLE.reply : SAMPLE.genericReply);
  const busy = (s) => ["building", "checking", "switching"].includes(s.phase);
  const hasActive = (s) => s.phase !== "idle";

  /** Top-bar tab: idle, building (teal pulse) or needs you (amber). */
  function tabTone(s) {
    if (s.setup === "running" || busy(s) || s.phase === "failed" || s.update?.status === "trying" || s.update?.status === "working" || s.removing?.step === "working")
      return "building";
    if (s.phase === "ready" || (s.update && ["pending"].includes(s.update.status) && s.update.kind === "needs")) return "needs";
    return "idle";
  }

  /* ------------------------------------------------------------------ */
  /* Shared mock parts (HTML strings)                                    */
  /* ------------------------------------------------------------------ */

  const P = {};

  P.dot = (tone, pulse) => `<span class="a-dot" data-tone="${tone}"${pulse ? ' data-pulse="true"' : ""}></span>`;

  P.pill = (kind, { boxed = false } = {}) => {
    const m = PHASE_LABEL[kind];
    if (!m) return "";
    return `<span class="a-pill${boxed ? " is-boxed" : ""}" data-tone="${m.tone}" data-status="${kind}">${P.dot(m.tone, m.pulse)}${m.label}</span>`;
  };

  /** The row's status: the phase of the active change, or "Kept". */
  P.phasePill = (s, opts) => P.pill(s.phase === "idle" ? "" : s.phase, opts);

  P.tabDot = (tone) =>
    tone === "building" ? P.dot("ok", true) : tone === "needs" ? P.dot("warn") : "";

  P.customizeTab = (tone, active = true) =>
    `<span class="a-nav" ${active ? 'aria-current="page"' : ""} data-tab-state="${tone}" data-focus="nav-customize">${icons.wrench}<span>Customize ADE</span>${P.tabDot(tone)}</span>`;

  P.topbar = (s) => {
    const tone = tabTone(s);
    const themeIcon = s.mockTheme === "dark" ? icons.moon : icons.sun;
    const menu = s.menuOpen
      ? `<div class="a-menu" role="menu" aria-label="Projects menu (mock)">
          ${
            s.width === "phone"
              ? `<div class="a-menu-label">Workspace</div>
                 <span class="a-menu-item" role="menuitem">${icons.inbox}Inbox</span>
                 <span class="a-menu-item" role="menuitem">${icons.chat}Luna ${P.dot("ok")}</span>
                 <span class="a-menu-item" role="menuitem" aria-current="page" data-menu-customize>${icons.wrench}Customize ADE ${P.tabDot(tone)}</span>
                 <div class="a-menu-sep"></div>`
              : ""
          }
          <div class="a-menu-label">Projects</div>
          <span class="a-menu-item" role="menuitem"><span class="a-avatar" data-hue="amber">A</span>Atlas</span>
          <span class="a-menu-item" role="menuitem"><span class="a-avatar">L</span>Lantern</span>
          <div class="a-menu-sep"></div>
          <span class="a-menu-item" role="menuitem">${icons.plus}Add a project</span>
        </div>`
      : "";
    if (s.width === "phone") {
      return `<header class="a-topbar">
        <span class="a-brand">ADE</span>
        <button type="button" class="a-menu-btn" data-act="menu" data-focus="menu" aria-expanded="${!!s.menuOpen}" aria-haspopup="menu" style="color:var(--ink);font-weight:500">Atlas ${icons.chevronDown}${P.tabDot(tone) ? "" : ""}</button>
        <button type="button" class="a-icon-btn" aria-label="Add a project (mock)">${icons.plus}</button>
        <span class="a-topbar-gap"></span>
        ${tone !== "idle" ? `<span class="a-nav" data-tab-state="${tone}" aria-label="Customize ADE is ${tone === "building" ? "working" : "waiting for you"}">${P.tabDot(tone)}</span>` : ""}
        <button type="button" class="a-icon-btn" aria-label="Settings (mock)">${icons.settings}</button>
        <button type="button" class="a-icon-btn" aria-label="Theme (mock)">${themeIcon}</button>
        ${menu}
      </header>`;
    }
    return `<header class="a-topbar">
      <span class="a-brand">ADE</span>
      <span class="a-nav">${icons.inbox}<span>Inbox</span></span>
      <span class="a-nav">${icons.chat}<span>Luna</span>${P.dot("ok")}</span>
      ${P.customizeTab(tone)}
      <span class="a-proj"><span class="a-avatar" data-hue="amber">A</span><b>Atlas</b></span>
      <span class="a-proj"><span class="a-avatar">L</span><span>Lantern</span></span>
      <button type="button" class="a-icon-btn" aria-label="Add a project (mock)">${icons.plus}</button>
      <span class="a-topbar-gap"></span>
      <button type="button" class="a-menu-btn" data-act="menu" data-focus="menu" aria-expanded="${!!s.menuOpen}" aria-haspopup="menu">Projects ${icons.chevronDown}</button>
      <button type="button" class="a-icon-btn" aria-label="Settings (mock)">${icons.settings}</button>
      <button type="button" class="a-icon-btn" aria-label="Theme (mock)">${themeIcon}</button>
      ${menu}
    </header>`;
  };

  P.statusLine = (s) => {
    if (s.setup !== "done") return { tone: "muted", text: s.setup === "running" ? "Setting up…" : "Not set up yet" };
    if (s.update?.status === "trying") return { tone: "ok", pulse: true, text: "The agent is trying again" };
    if (s.phase === "building") return { tone: "ok", pulse: true, text: "Building in a private copy" };
    if (s.phase === "checking") return { tone: "ok", pulse: true, text: "Running checks" };
    if (s.phase === "failed") return { tone: "bad", text: "Checks failed · the agent is fixing this" };
    if (s.phase === "ready") return { tone: "warn", text: "Ready to try · all checks passed" };
    if (s.phase === "switching") return { tone: "ok", pulse: true, text: "Switching to your version" };
    const n = s.kept.length;
    const where = s.phase === "kept" ? "You're on your version" : "Ready";
    return { tone: s.phase === "kept" ? "ok" : "muted", text: `${where} · ADE ${s.version} · ${n} ${n === 1 ? "change" : "changes"}` };
  };

  P.statusHtml = (s) => {
    const st = P.statusLine(s);
    return `<span class="a-pill" data-tone="${st.tone === "muted" ? "" : st.tone}" data-role="status-line">${P.dot(st.tone, st.pulse)}<span>${esc(st.text)}</span></span>`;
  };

  P.notice = (s) =>
    s.notice
      ? `<div class="m-notice" data-tone="${s.notice.tone || "info"}" role="status">${s.notice.tone === "error" ? icons.alert : icons.check}<span>${esc(s.notice.text)}</span></div>`
      : "";

  P.composer = (s, { placeholder = "Describe a change to ADE", label = "Describe a change", send = true } = {}) => {
    const locked = !(s.phase === "idle" || s.phase === "kept");
    return `<div class="a-composer">
      <button type="button" class="a-criteria" data-act="criteria" data-focus="criteria" aria-expanded="${!!s.criteria}">Acceptance criteria (optional)${icons.chevronDown}</button>
      ${s.criteria ? `<div class="a-criteria-body"><textarea data-act="done-when" data-focus="done-when" aria-label="Acceptance criteria" rows="2" placeholder="Done when… (for example: it works on a long session)"></textarea></div>` : ""}
      <textarea data-act="draft" data-focus="draft" aria-label="${esc(label)}" rows="2"
        placeholder="${locked ? "Finish or undo the current change first" : esc(placeholder)}" ${locked ? "disabled" : ""}>${esc(locked ? "" : s.draft)}</textarea>
      <div class="a-composer-bar">
        <span class="a-agent"><b>${SAMPLE.agent}</b><span>claude-opus-5-5 · Default</span></span>
        <span class="a-composer-gap"></span>
        <span class="a-tool" aria-hidden="true">/</span>
        <span class="a-tool" aria-hidden="true">@</span>
        <button type="button" class="a-icon-btn" aria-label="Attach a file (mock)">${icons.paperclip}</button>
        ${send ? `<button type="button" class="a-send" data-act="submit" data-focus="submit" aria-label="Send change request"
          ${locked || !s.draft.trim() ? "disabled" : ""}>${icons.arrowUp}</button>` : ""}
      </div>
    </div>`;
  };

  const SUGGESTIONS = [
    { title: "Copy a session's full log", text: SAMPLE.request, desc: "Add a button to the session header that copies everything, not just what's on screen." },
    { title: "Stop idle dev servers", text: "Stop dev servers that have been idle for an hour.", desc: "Shut down dev servers nobody has used for an hour, and say so in Processes." },
    { title: "Add a keyboard shortcut", text: "Add a keyboard shortcut to jump to Inbox.", desc: "Jump to Inbox from anywhere with one key combination." },
  ];

  /** The live ADE start screen: display heading, subline, three cards, then the composer. */
  P.start = (s, { composer = "", extra = "" } = {}) => `<div class="a-start" data-role="start">
      <div class="a-start-head"><h1>What should ADE do differently?</h1>
        <p>Describe a change and an agent builds it in your own copy of ADE</p></div>
      <div class="a-start-label">Start with an idea</div>
      <div class="a-cards">${SUGGESTIONS.map(
        (c, i) => `<button type="button" class="a-scard" data-act="suggest" data-text="${esc(c.text)}" data-focus="sg${i}">
          <span class="a-scard-top"><b>${esc(c.title)}</b>${icons.play}</span><span class="a-scard-desc">${esc(c.desc)}</span></button>`,
      ).join("")}</div>
      ${composer}${extra}
    </div>`;

  /** The conversation for the active change: user message, streamed reply, files. */
  P.thread = (s) => {
    if (!s.request) return "";
    const reply = replyText(s);
    const streaming = s.phase === "building";
    const text = streaming ? reply.slice(0, s.streamPos) : reply;
    const files = s.phase !== "building" ? P.files(s) : "";
    return `<div class="a-thread">
      <div class="a-msg is-user"><p>${esc(s.request)}</p></div>
      <div class="a-msg"><span class="a-msg-who">${SAMPLE.agent}</span>
        <p><span data-stream>${esc(text)}</span>${streaming ? '<span class="a-cursor" aria-hidden="true"></span>' : ""}</p>
        ${streaming ? `<span class="a-hint">Working in a private copy of ADE. Your live ADE isn't touched.</span>` : files}
      </div>
    </div>`;
  };

  P.files = (s) => {
    if (!hasActive(s)) return "";
    const f = isSample(s) ? SAMPLE.files : [{ path: "src/components/ade/Example.tsx", add: 12 }];
    return `<div class="a-files" aria-label="Changed files">${f
      .map((x) => `<div class="a-file">${icons.file}<code>${esc(x.path)}</code><span class="a-add">+${x.add}</span></div>`)
      .join("")}</div>`;
  };

  const checkMark = (c) =>
    c.s === "pass" ? icons.circleCheck : c.s === "fail" ? icons.circleX : c.s === "run" ? `<span class="a-spin" style="display:grid">${icons.loader}</span>` : icons.circle;

  P.checks = (s, { output = true } = {}) => {
    const rows = s.checks
      .map((c) => {
        const time = c.s === "wait" ? "" : c.time;
        const skipped = c.s === "wait" && s.phase === "failed";
        return `<div class="a-check" data-s="${c.s}" data-check="${esc(c.name)}">
          <span class="a-check-mark">${checkMark(c)}</span>
          <span class="a-check-name">${esc(c.name)}</span>
          <span class="a-check-time">${skipped ? "Skipped" : esc(time)}</span>
        </div>`;
      })
      .join("");
    const failed = s.phase === "failed" && output;
    return `<div class="a-checks" role="list" aria-label="Checks">${rows}</div>
      ${
        failed
          ? `<div class="a-output" data-role="fail-output">${SAMPLE.failOutput
              .map(([k, l]) => `<span class="${k}">${esc(l)}</span>`)
              .join("\n")}</div>
             <div class="a-note"><span class="a-spin" style="display:grid">${icons.loader}</span>The agent is fixing this. Keep it stays off until every check passes.</div>`
          : ""
      }`;
  };

  P.actions = (s, { large = false } = {}) => {
    const ready = s.phase === "ready" && allPass(s);
    const cls = large ? " is-lg" : "";
    const pre = hasActive(s) && !["switching", "kept"].includes(s.phase);
    if (!pre) return "";
    return `<div class="a-actions" role="group" aria-label="Change actions">
      <button type="button" class="a-btn${cls}" data-act="try" data-focus="act-try" ${ready ? "" : "disabled"}>${icons.eye}Try it</button>
      <button type="button" class="a-btn is-primary${cls}" data-act="keep" data-focus="act-keep" ${ready ? "" : "disabled"}
        title="${ready ? "Keep this change in your ADE" : "Keep it turns on when every check passes"}">${icons.check}Keep it</button>
      <button type="button" class="a-btn${cls}" data-act="undo" data-focus="act-undo">${icons.undo}Undo</button>
    </div>`;
  };

  P.switching = (s) => {
    const steps = SAMPLE.switchSteps
      .map((label, i) => {
        const st = i < s.switchStep ? "pass" : i === s.switchStep ? "run" : "wait";
        const mark = st === "pass" ? icons.circleCheck : st === "run" ? `<span class="a-spin" style="display:grid">${icons.loader}</span>` : icons.circle;
        const extra = st === "run" && i === 2 ? '<span class="a-check-time">Reconnecting…</span>' : "";
        return `<div class="a-switch-step" data-s="${st}"><span class="a-check-mark">${mark}</span><span class="a-check-name">${label}</span>${extra}</div>`;
      })
      .join("");
    return `<div class="a-switch" role="list" aria-label="Switching to your version">${steps}</div>`;
  };

  P.kept = (s) =>
    s.phase === "kept"
      ? `<div class="a-success" role="status">${icons.circleCheck}You're on your version.</div>`
      : "";

  /** Preview: a second ADE on 127.0.0.1:3101 with test data, in the Browser. */
  P.preview = (s) => {
    const copied = s.copied;
    return `<div class="a-browser" data-role="preview">
      <div class="a-browser-bar">
        <div class="a-browser-url">${icons.lock}<span>127.0.0.1:3101</span></div>
        <span class="a-browser-tag">Preview · test data</span>
      </div>
      <div class="a-pv">
        <div class="a-pv-head">
          <div><span class="a-pv-title">Fix checkout totals</span><span class="a-mono">Claude Code · Complete · test session</span></div>
          <span class="a-pv-new">
            <span class="a-pv-flag">New</span>
            <button type="button" class="a-btn" data-act="copylog" data-focus="copylog">${copied ? icons.check : icons.copy}${copied ? "Copied" : "Copy log"}</button>
          </span>
          <button type="button" class="a-btn" tabindex="-1" aria-disabled="true" style="opacity:.55">${icons.square}Stop</button>
        </div>
        <div class="a-pv-log">$ node --test<br>▶ 1,204 lines in this session log<br>✔ checkout totals keep rounding<br>✔ discount applied once</div>
        <p class="a-pv-foot">Try Copy log. It copies all 1,204 lines, not just the 200 on screen. This preview is a separate copy of ADE with test data; nothing here is your real workspace.</p>
      </div>
    </div>`;
  };

  P.updateBanner = (s) => {
    const u = s.update;
    if (!u) return "";
    const name = SAMPLE.keptFirst.title;
    if (u.kind === "carry") {
      if (u.status === "pending")
        return `<div class="a-banner" data-role="update" data-tone="ok"><div class="a-banner-text"><b>ADE ${SAMPLE.nextVersion} is ready</b><span>Your ${s.kept.length === 1 ? "change carries" : "changes carry"} over automatically.</span></div>
          <button type="button" class="a-btn is-primary" data-act="update-now" data-focus="update-now">Update to ${SAMPLE.nextVersion}</button></div>`;
      if (u.status === "working")
        return `<div class="a-banner" data-role="update" data-tone="ok"><div class="a-banner-text"><b>Updating to ${SAMPLE.nextVersion}</b><span>Re-applying your changes and restarting ADE…</span></div><span class="a-spin" style="display:grid">${icons.loader}</span></div>`;
      return `<div class="a-banner" data-role="update" data-tone="ok"><div class="a-banner-text"><b>ADE is on ${SAMPLE.nextVersion}</b><span>Your ${s.kept.length === 1 ? "change carried" : "changes carried"} over.</span></div></div>`;
    }
    if (u.status === "pending")
      return `<div class="a-banner" data-role="update"><div class="a-banner-text"><b>“${esc(name)}” can't carry over to ${SAMPLE.nextVersion}</b><span>ADE changed the part it used. Choose what to do. Nothing changes until you do.</span></div>
        <div class="a-actions">
          <button type="button" class="a-btn is-primary" data-act="update-retry" data-focus="update-retry">Let the agent try again</button>
          <button type="button" class="a-btn" data-act="update-without" data-focus="update-without">Update without it</button>
          <button type="button" class="a-btn" data-act="update-stay" data-focus="update-stay">Stay on ${SAMPLE.version}</button>
        </div></div>`;
    if (u.status === "trying")
      return `<div class="a-banner" data-role="update" data-tone="ok"><div class="a-banner-text"><b>The agent is trying again</b><span>Rebuilding “${esc(name)}” for ${SAMPLE.nextVersion} and running the checks.</span></div><span class="a-spin" style="display:grid">${icons.loader}</span></div>`;
    if (u.status === "stayed")
      return `<div class="a-banner" data-role="update"><div class="a-banner-text"><b>Staying on ${SAMPLE.version}</b><span>Your changes stay as they are. ${SAMPLE.nextVersion} is waiting whenever you want it.</span></div>
        <button type="button" class="a-btn" data-act="update-review" data-focus="update-review">Review update</button></div>`;
    return `<div class="a-banner" data-role="update" data-tone="ok"><div class="a-banner-text"><b>ADE is on ${SAMPLE.nextVersion}</b><span>${esc(u.result || "")}</span></div></div>`;
  };

  P.setup = (s) => {
    if (s.setup === "running") {
      const mb = Math.round((s.setupPct / 100) * 700);
      return `<div class="a-card"><div class="a-setup" data-role="setup">
        <span class="a-setup-icon">${icons.download}</span>
        <h2>Setting up customization</h2>
        <div class="a-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.setupPct}"><i style="width:${s.setupPct}%"></i></div>
        <p>Downloading build tools · ${mb} MB of 700 MB (${s.setupPct}%). Keep this page open. You can keep using ADE meanwhile.</p>
      </div></div>`;
    }
    return `<div class="a-card"><div class="a-setup" data-role="setup">
      <span class="a-setup-icon">${icons.wrench}</span>
      <h2>Make ADE work the way you do</h2>
      <p>Describe a feature, a tool or a behavior change and an agent builds it in a private copy of ADE. You try it first, and keep it only if you like it. Colors and layout stay as designed.</p>
      <p>First, a one-time setup downloads build tools, about 0.7 GB. It takes a few minutes.</p>
      <button type="button" class="a-btn is-primary is-lg" data-act="setup" data-focus="setup">${icons.download}Set up customization</button>
    </div></div>`;
  };

  /** One kept change with Remove (inline in-page confirm, never confirm()). */
  P.keptRow = (s, k) => {
    const rm = s.removing && s.removing.id === k.id ? s.removing : null;
    const main = `<div class="a-kept" data-kept="${esc(k.id)}">
      <span class="a-dot" data-tone="${rm?.step === "working" ? "ok" : "muted"}"${rm?.step === "working" ? ' data-pulse="true"' : ""}></span>
      <div class="a-kept-text"><span class="a-kept-title">${esc(k.title)}</span><span class="a-kept-sub">Kept ${esc(k.when)} · ${esc(k.area)}</span></div>
      ${
        rm?.step === "working"
          ? `<span class="a-pill" data-tone="ok">Removing…</span>`
          : `<button type="button" class="a-btn is-ghost" data-act="remove" data-id="${esc(k.id)}" data-focus="remove-${esc(k.id)}" aria-label="Remove ${esc(k.title)}">${icons.trash}Remove</button>`
      }
    </div>`;
    const confirm =
      rm?.step === "confirm"
        ? `<div class="a-confirm" role="alertdialog" aria-label="Remove ${esc(k.title)}?"><span>Remove “${esc(k.title)}”? ADE waits for running agents, saves a backup and restarts without it.</span>
            <button type="button" class="a-btn" data-act="remove-cancel" data-focus="remove-cancel">Cancel</button>
            <button type="button" class="a-btn is-primary" data-act="remove-confirm" data-id="${esc(k.id)}" data-focus="remove-confirm">Remove</button></div>`
        : rm?.step === "working"
          ? `<div class="a-confirm"><span class="a-note"><span class="a-spin" style="display:grid">${icons.loader}</span>${SAMPLE.removeSteps}…</span></div>`
          : "";
    return main + confirm;
  };

  P.yourChanges = (s, { empty = true } = {}) => {
    if (!s.kept.length)
      return empty ? `<div class="a-card"><div class="a-empty">Nothing yet. Changes you keep show up here.</div></div>` : "";
    return `<div class="a-card" data-role="your-changes">${s.kept.map((k) => P.keptRow(s, k)).join("")}</div>`;
  };

  P.stockHint = () => `<p class="a-hint">To start ADE without your changes, run <code>ade --stock</code>.</p>`;

  P.sheet = ({ title, body, foot = "", close = "close-sheet", bottom = false }) =>
    `<div class="a-scrim${bottom ? " is-bottom" : ""}" data-act="scrim">
      <aside class="a-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="a-sheet-head"><h2>${esc(title)}</h2>
          <button type="button" class="a-icon-btn" data-act="${close}" data-focus="sheet-close" aria-label="Close">${icons.x}</button></div>
        <div class="a-sheet-body">${body}</div>
        ${foot ? `<div class="a-sheet-foot">${foot}</div>` : ""}
      </aside></div>`;

  /** A kept change's own conversation (rail and ledger views). */
  P.keptThread = (k) =>
    `<div class="a-thread"><div class="a-msg is-user"><p>${esc(k.request)}</p></div>
      <div class="a-msg"><span class="a-msg-who">${SAMPLE.agent}</span><p>${esc(k.reply)}</p>
        <div class="a-files">${k.files.map((x) => `<div class="a-file">${icons.file}<code>${esc(x.path)}</code><span class="a-add">+${x.add}</span></div>`).join("")}</div></div></div>`;

  /* ------------------------------------------------------------------ */
  /* Engine: the whole change lifecycle, shared by every option          */
  /* ------------------------------------------------------------------ */

  function createEngine(ctx, root) {
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };
    const every = (fn, ms) => {
      const t = setInterval(fn, ms);
      timers.add(t);
      return t;
    };
    const stop = (t) => {
      clearInterval(t);
      clearTimeout(t);
      timers.delete(t);
    };
    const S = () => ctx.getState();
    const say = (text, tone) => {
      ctx.setState({ notice: { text, tone } });
      ctx.report(text);
      later(() => {
        if (S().notice?.text === text) ctx.setState({ notice: null });
      }, 3200);
    };

    const eng = {
      destroy() {
        for (const t of timers) {
          clearTimeout(t);
          clearInterval(t);
        }
        timers.clear();
      },

      setup() {
        if (S().setup !== "needed") return;
        ctx.setState({ setup: "running", setupPct: 0 });
        ctx.report("Setting up customization");
        const t = every(() => {
          const pct = Math.min(100, S().setupPct + 5);
          if (pct < 100) return ctx.setState({ setupPct: pct });
          stop(t);
          ctx.setState({ setup: "done", setupPct: 100 });
          say("Customization is ready");
        }, 160);
      },

      submit(text) {
        const s = S();
        const request = String(text ?? s.draft).trim();
        if (!request || !(s.phase === "idle" || s.phase === "kept") || s.setup !== "done") return;
        ctx.setState({
          phase: "building",
          request,
          draft: "",
          streamPos: 0,
          checks: pendingChecks(),
          previewOpen: false,
          tried: false,
          copied: false,
          switchStep: -1,
          ui: { ...s.ui, sheetOpen: false, rightOpen: undefined },
        });
        ctx.report("Building your change in a private copy");
        const reply = replyText(S());
        const t = every(() => {
          const pos = Math.min(reply.length, S().streamPos + 5);
          ctx.patch({ streamPos: pos });
          root.querySelectorAll("[data-stream]").forEach((n) => (n.textContent = reply.slice(0, pos)));
          if (pos >= reply.length) {
            stop(t);
            later(() => eng.runChecks(0), 250);
            ctx.setState({ phase: "checking" });
          }
        }, 30);
      },

      runChecks(i) {
        const s = S();
        if (s.phase !== "checking") return;
        if (i >= SAMPLE.checks.length) {
          ctx.setState({ phase: "ready" });
          ctx.report("Checks passed. Ready to try.");
          return;
        }
        const def = SAMPLE.checks[i];
        const checks = s.checks.map((c, k) => (k === i ? { ...c, s: "run" } : c));
        ctx.setState({ checks });
        later(() => {
          if (S().phase !== "checking") return;
          const fail = S().failTests && def.name === "Tests";
          const next = S().checks.map((c, k) =>
            k === i ? { ...c, s: fail ? "fail" : "pass", time: fail ? def.failTime : def.time } : c,
          );
          if (fail) {
            ctx.setState({ checks: next, phase: "failed" });
            ctx.report("Tests failed. The agent is fixing this.");
            return;
          }
          ctx.setState({ checks: next });
          eng.runChecks(i + 1);
        }, def.ms);
      },

      tryIt() {
        const s = S();
        if (s.phase !== "ready") return;
        ctx.setState({ previewOpen: true, tried: true });
        ctx.report("Preview open on 127.0.0.1:3101");
      },

      closePreview() {
        ctx.setState({ previewOpen: false });
      },

      copyLog() {
        ctx.setState({ copied: true });
        later(() => ctx.setState({ copied: false }), 1600);
      },

      keep() {
        const s = S();
        if (s.phase !== "ready" || !allPass(s)) return;
        ctx.setState({ phase: "switching", switchStep: 0, previewOpen: false });
        ctx.report("Switching to your version");
        const step = (i) =>
          later(() => {
            if (S().phase !== "switching") return;
            if (i < SAMPLE.switchSteps.length - 1) {
              ctx.setState({ switchStep: i + 1 });
              return step(i + 1);
            }
            const item = {
              id: "k" + Date.now(),
              title: changeTitle(S()),
              area: isSample(S()) ? SAMPLE.area : "ADE",
              when: "just now",
              request: S().request,
              reply: replyText(S()),
              files: isSample(S()) ? SAMPLE.files : [{ path: "src/components/ade/Example.tsx", add: 12 }],
            };
            ctx.setState({ phase: "kept", switchStep: SAMPLE.switchSteps.length, kept: [item, ...S().kept] });
            say("You're on your version.");
          }, i === 2 ? 1100 : 750);
        step(0);
      },

      undo() {
        const s = S();
        if (!hasActive(s) || ["switching"].includes(s.phase)) return;
        ctx.setState({
          phase: "idle",
          request: "",
          draft: SAMPLE.request,
          checks: pendingChecks(),
          previewOpen: false,
          tried: false,
          copied: false,
          switchStep: -1,
          ui: { ...s.ui, sheetOpen: false },
        });
        eng.destroyTimers();
        say("Change discarded. Nothing in your ADE changed.");
      },

      newChange() {
        const s = S();
        if (s.phase !== "kept") return;
        ctx.setState({ phase: "idle", request: "", draft: SAMPLE.request, checks: pendingChecks(), switchStep: -1, tried: false, previewOpen: false, ui: { ...s.ui, sel: null, rightOpen: undefined } });
      },

      destroyTimers() {
        // Pending check or stream timers must not revive a discarded change.
        for (const t of timers) {
          clearTimeout(t);
          clearInterval(t);
        }
        timers.clear();
      },

      removeAsk(id) {
        ctx.setState({ removing: { id, step: "confirm" } });
      },
      removeCancel() {
        ctx.setState({ removing: null });
      },
      removeConfirm(id) {
        ctx.setState({ removing: { id, step: "working" } });
        ctx.report("Restarting ADE without that change");
        later(() => {
          const gone = S().kept.find((k) => k.id === id);
          ctx.setState({ kept: S().kept.filter((k) => k.id !== id), removed: gone ? [gone, ...S().removed] : S().removed, removing: null });
          say(`Removed “${gone?.title || "change"}”.`);
        }, 1200);
      },

      updateNow() {
        ctx.setState({ update: { ...S().update, status: "working" } });
        later(() => {
          ctx.setState({ update: { ...S().update, status: "done" }, version: SAMPLE.nextVersion });
          say(`ADE is on ${SAMPLE.nextVersion}`);
        }, 1400);
      },
      updateRetry() {
        ctx.setState({ update: { ...S().update, status: "trying" } });
        ctx.report("The agent is trying again");
        later(() => {
          ctx.setState({
            update: { ...S().update, status: "done", result: "The agent fixed it. Your change carried over." },
            version: SAMPLE.nextVersion,
          });
          say(`ADE is on ${SAMPLE.nextVersion} with your change`);
        }, 1800);
      },
      updateWithout() {
        const k = S().kept.filter((x) => x.id !== SAMPLE.keptFirst.id);
        ctx.setState({
          kept: k,
          update: { ...S().update, status: "done", result: `Updated without “${SAMPLE.keptFirst.title}”. You can ask for it again.` },
          version: SAMPLE.nextVersion,
        });
        say(`Updated to ${SAMPLE.nextVersion} without that change`);
      },
      updateStay() {
        ctx.setState({ update: { ...S().update, status: "stayed" } });
        say(`Staying on ${SAMPLE.version}`);
      },
      updateReview() {
        ctx.setState({ update: { ...S().update, status: "pending" } });
      },
    };
    return eng;
  }

  /* ------------------------------------------------------------------ */
  /* Option helper                                                       */
  /* ------------------------------------------------------------------ */

  const common = {
    criteria: (el, ev, eng, ctx) => ctx.setState({ criteria: !ctx.getState().criteria }),
    suggest: (el, ev, eng, ctx) => {
      ctx.setState({ draft: el.dataset.text });
      el.closest(".mock")?.querySelector('[data-act="draft"]')?.focus();
    },
    menu: (el, ev, eng, ctx) => ctx.setState({ menuOpen: !ctx.getState().menuOpen }),
    setup: (el, ev, eng) => eng.setup(),
    submit: (el, ev, eng) => eng.submit(),
    try: (el, ev, eng) => eng.tryIt(),
    keep: (el, ev, eng) => eng.keep(),
    undo: (el, ev, eng) => eng.undo(),
    "new-change": (el, ev, eng) => eng.newChange(),
    copylog: (el, ev, eng) => eng.copyLog(),
    remove: (el, ev, eng) => eng.removeAsk(el.dataset.id),
    "remove-cancel": (el, ev, eng) => eng.removeCancel(),
    "remove-confirm": (el, ev, eng) => eng.removeConfirm(el.dataset.id),
    "update-now": (el, ev, eng) => eng.updateNow(),
    "update-retry": (el, ev, eng) => eng.updateRetry(),
    "update-without": (el, ev, eng) => eng.updateWithout(),
    "update-stay": (el, ev, eng) => eng.updateStay(),
    "update-review": (el, ev, eng) => eng.updateReview(),
  };

  const registry = new Map();

  /** An option supplies `render(state)` and `act` handlers; the rest is shared. */
  function defineOption(def) {
    registry.set(def.id, def);
    def.mount = function (root, ctx) {
      const eng = createEngine(ctx, root);
      const draw = () => {
        const s = ctx.getState();
        WS.renderKeepFocus(root, def.render(s));
      };
      const ui = (patch) => ctx.setState({ ui: { ...ctx.getState().ui, ...patch } });
      const handlers = { ...common, ...(def.act || {}) };
      const fire = (name, el, ev) => {
        const fn = handlers[name];
        if (fn) fn(el, ev, eng, ctx, ui);
      };
      if (ctx.kind === "full") {
        root.addEventListener("click", (e) => {
          const el = e.target.closest("[data-act]");
          if (!el || !root.contains(el) || el.disabled) return;
          if (el.dataset.act === "scrim" && e.target !== el) return;
          if (el.dataset.act === "scrim") return fire("close-sheet", el, e);
          fire(el.dataset.act, el, e);
        });
        root.addEventListener("input", (e) => {
          const other = e.target.closest("[data-act]");
          if (other && def.input?.[other.dataset.act]) return def.input[other.dataset.act](other, ctx, ui);
          const el = e.target.closest('[data-act="draft"]');
          if (!el) return;
          ctx.patch({ draft: el.value });
          root.querySelectorAll('[data-act="submit"]').forEach((b) => (b.disabled = !el.value.trim()));
        });
        root.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && e.target.matches?.('[data-act="draft"]')) {
            e.preventDefault();
            eng.submit();
          } else if (e.key === "Escape") {
            const s = ctx.getState();
            if (s.menuOpen) ctx.setState({ menuOpen: false });
            else if (s.ui.sheetOpen || s.ui.previewSheet) ui({ sheetOpen: false, previewSheet: false });
          }
        });
      }
      return {
        update: draw,
        destroy: () => eng.destroy(),
      };
    };
    return def;
  }

  /* ------------------------------------------------------------------ */
  /* Shell                                                               */
  /* ------------------------------------------------------------------ */

  const WS = { icons, P, SAMPLE, esc, freshState, presetReady, tabTone, defineOption, allPass, changeTitle, hasActive, busy, isSample };
  window.WS = WS;

  WS.renderKeepFocus = function (el, html) {
    const active = document.activeElement;
    const key = active && el.contains(active) ? active.getAttribute("data-focus") : null;
    const caret = key && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
    const scrolls = {};
    el.querySelectorAll("[data-scroll]").forEach((n) => {
      scrolls[n.dataset.scroll] = {
        top: n.scrollTop,
        stick: n.scrollHeight - n.scrollTop - n.clientHeight < 40,
      };
    });
    el.innerHTML = html;
    el.querySelectorAll("[data-scroll]").forEach((n) => {
      const r = scrolls[n.dataset.scroll];
      if (!r) return;
      n.scrollTop = n.hasAttribute("data-stick") && r.stick ? n.scrollHeight : r.top;
    });
    if (key) {
      const t = el.querySelector(`[data-focus="${CSS.escape(key)}"]`);
      if (t && !t.disabled) {
        t.focus({ preventScroll: true });
        if (caret && "setSelectionRange" in t) {
          try {
            t.setSelectionRange(caret[0], caret[1]);
          } catch {
            /* not a text field */
          }
        }
      }
    }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const states = new Map();
  const SIZES = { desktop: [1440, 900], phone: [390, 844] };
  const live = [];
  let resizeObs = null;
  let controlsCarry = { mockTheme: "dark", width: "desktop", scenario: "ready", fit: "100" };

  function stateFor(o) {
    if (!states.has(o.id)) states.set(o.id, freshState(controlsCarry.scenario, { mockTheme: controlsCarry.mockTheme, width: controlsCarry.width }));
    return states.get(o.id);
  }

  function injectCss(o) {
    if (!o.css || document.getElementById(`opt-css-${o.id}`)) return;
    const style = document.createElement("style");
    style.id = `opt-css-${o.id}`;
    style.textContent = o.css;
    document.head.appendChild(style);
  }

  function mountInstance(o, root, { kind, getState, setState, patch, onReport }) {
    root.classList.add("mock", `opt-${o.id}`);
    const sync = () => {
      const s = getState();
      root.dataset.mockTheme = s.mockTheme;
      root.dataset.width = s.width;
    };
    sync();
    const ctx = { kind, getState, setState, patch, report: onReport || (() => {}), icons, P };
    const inst = o.mount(root, ctx) || {};
    const handle = {
      update() {
        sync();
        inst.update?.(getState());
      },
      destroy() {
        inst.destroy?.();
        root.replaceChildren();
        root.className = "";
      },
    };
    handle.update();
    return handle;
  }

  function teardown() {
    while (live.length) live.pop().destroy();
    resizeObs?.disconnect();
    resizeObs = null;
  }

  const ordered = () => [...registry.values()].sort((a, b) => a.id - b.id);

  /** Static close-ups for the overview: small controls, in context. */
  function renderCloseups() {
    const host = $("#closeups");
    if (!host) return;
    const box = (label, html, theme = "light", wide = false) =>
      `<figure class="closeup${wide ? " is-wide" : ""}"><figcaption>${label}</figcaption>
        <div class="closeup-box mock" data-mock-theme="${theme}" data-width="desktop"><div class="cu">${html}</div></div></figure>`;
    const tab = (tone) =>
      `<div class="cu-bar">${P.customizeTab(tone)}<span class="a-proj"><span class="a-avatar" data-hue="amber">A</span><b>Atlas</b></span></div>`;
    const tabs = (theme) =>
      box(`Top-bar tab · idle, building, needs you${theme === "dark" ? " · dark" : ""}`,
        `<div class="cu-stack">
          <div class="cu-line"><span class="a-mono">Idle</span>${tab("idle")}</div>
          <div class="cu-line"><span class="a-mono">Building</span>${tab("building")}</div>
          <div class="cu-line"><span class="a-mono">Needs you</span>${tab("needs")}</div>
        </div>`, theme);
    const pills = box("Change status pills",
      `<div class="cu-stack">${["building", "checking", "ready", "failed", "switching", "kept", "needs"]
        .map((k) => `<div class="cu-line"><span class="a-mono" style="width:84px">${k}</span>${P.pill(k)}${P.pill(k, { boxed: true })}</div>`)
        .join("")}</div>`);
    const pair = box("Keep it and Undo · ready, then waiting on checks",
      `<div class="cu-stack">
        <div class="cu-line"><span class="a-mono" style="width:60px">Ready</span><div class="a-actions"><button class="a-btn" tabindex="-1">${icons.eye}Try it</button><button class="a-btn is-primary" tabindex="-1">${icons.check}Keep it</button><button class="a-btn" tabindex="-1">${icons.undo}Undo</button></div></div>
        <div class="cu-line"><span class="a-mono" style="width:60px">Waiting</span><div class="a-actions"><button class="a-btn" disabled>${icons.eye}Try it</button><button class="a-btn is-primary" disabled>${icons.check}Keep it</button><button class="a-btn" tabindex="-1">${icons.undo}Undo</button></div></div>
        <p class="a-hint">Keep it turns on only when every check passes.</p>
      </div>`);
    const upd = box("ADE update · a change that needs you",
      `<div class="a-banner" data-role="update"><div class="a-banner-text"><b>“${esc(SAMPLE.keptFirst.title)}” can't carry over to ${SAMPLE.nextVersion}</b><span>ADE changed the part it used. Nothing changes until you choose.</span></div>
        <div class="a-actions"><button class="a-btn is-primary" tabindex="-1">Let the agent try again</button><button class="a-btn" tabindex="-1">Update without it</button><button class="a-btn" tabindex="-1">Stay on ${SAMPLE.version}</button></div></div>`, "light", true);
    host.innerHTML = tabs("light") + tabs("dark") + pills + pair + upd;
  }

  function renderOverview() {
    teardown();
    $("#view-overview").hidden = false;
    $("#view-option").hidden = true;
    const grid = $("#overview-grid");
    grid.replaceChildren();
    for (const o of ordered()) {
      injectCss(o);
      const card = document.createElement("article");
      card.className = "ov-card";
      card.innerHTML = `
        <a class="ov-thumb" href="#option-${o.id}" aria-label="Open option ${o.id}, ${o.name}">
          <div class="ov-thumb-frame"><div class="ov-thumb-mount"></div></div>
        </a>
        <div class="ov-meta">
          <div class="ov-num">Option ${o.id}${o.recommended ? " · Recommended" : ""}</div>
          <h3><a href="#option-${o.id}">${o.name}</a></h3>
          <p>${o.tradeoff}</p>
        </div>`;
      grid.appendChild(card);
      const thumbState = presetReady(freshState("ready"));
      thumbState.ui = { ...(o.thumbUi || {}) };
      const frame = $(".ov-thumb-frame", card);
      const mountEl = $(".ov-thumb-mount", card);
      mountEl.style.width = `${SIZES.desktop[0]}px`;
      mountEl.style.height = `${SIZES.desktop[1]}px`;
      live.push(
        mountInstance(o, mountEl, { kind: "thumb", getState: () => thumbState, setState: () => {}, patch: () => {} }),
      );
      const fit = () => {
        const sc = frame.clientWidth / SIZES.desktop[0];
        mountEl.style.transform = `scale(${sc})`;
        frame.style.height = `${SIZES.desktop[1] * sc}px`;
      };
      fit();
      frame._fit = fit;
      (resizeObs ||= new ResizeObserver((entries) => entries.forEach((en) => en.target._fit?.()))).observe(frame);
    }
    renderCloseups();
  }

  function renderOption(id) {
    const o = registry.get(id);
    if (!o) return renderOverview();
    teardown();
    injectCss(o);
    $("#view-overview").hidden = true;
    $("#view-option").hidden = false;

    const list = ordered();
    const idx = list.indexOf(o);
    const prev = list[(idx - 1 + list.length) % list.length];
    const next = list[(idx + 1) % list.length];
    $("#opt-prev").href = `#option-${prev.id}`;
    $("#opt-prev").textContent = `‹ ${prev.id}. ${prev.name}`;
    $("#opt-next").href = `#option-${next.id}`;
    $("#opt-next").textContent = `${next.id}. ${next.name} ›`;
    $("#opt-jump").innerHTML = list
      .map((x) => `<a href="#option-${x.id}" ${x === o ? 'aria-current="page"' : ""} title="${x.name}">${x.id}</a>`)
      .join("");
    $("#opt-eyebrow").textContent = `Option ${o.id}${o.recommended ? " · Recommended" : ""}`;
    $("#opt-title").textContent = o.name;
    $("#opt-tradeoff").textContent = o.tradeoff;
    $("#opt-notes").innerHTML = (o.notes || []).map((n) => `<li>${n}</li>`).join("");

    const state = stateFor(o);
    const stage = $("#stage");
    const frame = $("#stage-frame");
    const mountEl = document.createElement("div");
    frame.replaceChildren(mountEl);

    const fit = () => {
      const [w, h] = SIZES[state.width] || SIZES.desktop;
      const sc = state.width === "phone" || controlsCarry.fit === "fit" ? Math.min(1, stage.clientWidth / w) : 1;
      mountEl.style.width = `${w}px`;
      mountEl.style.height = `${h}px`;
      mountEl.style.transform = `scale(${sc})`;
      frame.style.width = `${w * sc}px`;
      frame.style.height = `${h * sc}px`;
      $("#scale-note").textContent = sc < 1 ? `Shown at ${Math.round(sc * 100)}% to fit` : "Shown at 100%";
      $("#mock-size").textContent = `Mock ADE · ${w} × ${h} · local simulation only`;
    };

    const syncControls = () => {
      document.querySelectorAll("#ctl-scenario button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.scenario)));
      document.querySelectorAll("#ctl-theme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.mockTheme)));
      document.querySelectorAll("#ctl-fit button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === controlsCarry.fit)));
      document.querySelectorAll("#ctl-width button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.width)));
    };

    let reported = "";
    const setState = (partial) => {
      Object.assign(state, partial);
      syncControls();
      if ("width" in partial) fit();
      for (const inst of live) inst.update();
    };
    const patch = (partial) => Object.assign(state, partial);

    live.push(
      mountInstance(o, mountEl, {
        kind: "full",
        getState: () => state,
        setState,
        patch,
        onReport: (text) => {
          if (text !== reported) $("#readout").textContent = reported = text;
        },
      }),
    );
    fit();
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(stage);

    const rebuild = (scenario) => {
      states.delete(o.id);
      controlsCarry = { mockTheme: state.mockTheme, width: state.width, scenario: scenario || state.scenario, fit: controlsCarry.fit };
      renderOption(id);
    };
    $("#ctl-scenario").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) rebuild(b.dataset.v);
    };
    $("#ctl-theme").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ mockTheme: b.dataset.v });
    };
    $("#ctl-width").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ width: b.dataset.v });
    };
    $("#ctl-fit").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      controlsCarry.fit = b.dataset.v;
      syncControls();
      fit();
    };
    $("#ctl-reset").onclick = () => {
      rebuild();
      $("#ctl-reset").focus();
    };
    $("#readout").textContent = "";
    syncControls();
  }

  function route() {
    const m = /^#option-(\d+)$/.exec(location.hash);
    if (m) {
      renderOption(Number(m[1]));
      window.scrollTo({ top: 0 });
    } else {
      renderOverview();
    }
  }

  WS.start = function () {
    window.addEventListener("hashchange", route);
    route();
  };
})();
