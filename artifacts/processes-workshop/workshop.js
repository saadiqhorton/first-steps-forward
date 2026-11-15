/* Processes workshop: option registry, shared sample content, and the comparison
 * shell. Options live in options/*.js and call WS.register().
 *
 * Everything here is local sample data. No control reaches ADE's API.
 */
(function () {
  "use strict";

  const svg = (body) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

  // Lucide paths (ADE uses lucide-react).
  const icons = {
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    copy: svg(
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ),
    square: svg('<rect width="14" height="14" x="5" y="5" rx="2"/>'),
    play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    external: svg(
      '<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>',
    ),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
    more: svg(
      '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    ),
    terminal: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>'),
    globe: svg(
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    ),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg(
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ),
    clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    folder: svg(
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    ),
    wrap: svg(
      '<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="10" y1="18" y2="18"/>',
    ),
    arrowDown: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
    monitor: svg(
      '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    ),
    dots: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'),
    message: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    settings: svg(
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    ),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    panelRight: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'),
    loader: svg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),
  };

  /* ------------------------------------------------------------------ */
  /* Sample content — identical for every option                        */
  /* ------------------------------------------------------------------ */

  const CONVERSATIONS = [
    {
      id: "c1",
      title: "Add a booking flow",
      agent: "Claude Code",
      state: "Working",
      age: "4 min ago",
    },
    {
      id: "c2",
      title: "Fix checkout totals",
      agent: "Codex",
      state: "Complete",
      age: "2 hr ago",
    },
  ];

  const OUTPUT = {
    p1: [
      "$ npm run dev -- --host 127.0.0.1 --port 5173",
      "",
      "> first-steps-forward@0.1.13 dev",
      "> vite dev --host 127.0.0.1 --port 5173",
      "",
      "  VITE v8.1.5  ready in 412 ms",
      "",
      "  ➜  Local:   http://127.0.0.1:5173/",
      "  ➜  press h + enter to show help",
      "",
      "2:37:04 PM [vite] page reload src/routes/index.tsx",
      "2:37:41 PM [vite] hmr update /src/styles.css",
      "2:38:02 PM [vite] hmr update /src/components/ade/Composer.tsx",
      "2:38:19 PM [vite] page reload src/routes/p.$projectId.conversations.tsx",
      "2:38:44 PM [vite] hmr update /src/components/ade/SectionTabs.tsx",
      "2:39:02 PM [vite] hmr update /src/lib/ade/navigation.ts",
      "2:39:18 PM GET /api/bootstrap 200 6ms",
      "2:39:31 PM GET /api/sessions/9c1f/logs?after=412 200 3ms",
      "2:39:35 PM POST /api/sessions/9c1f/turns 202 1ms",
      "2:39:58 PM [vite] hmr update /src/components/ade/ProcessList.tsx",
      "2:40:12 PM GET /api/projects/2b6f/processes 200 2ms",
      "2:40:20 PM GET /api/processes/0c7a/output?after=880 200 1ms",
      "2:40:20 PM GET /api/processes/0c7a/output?after=881 200 1ms",
      "2:40:26 PM [vite] page reload src/routes/p.$projectId.processes.tsx",
      "2:40:41 PM GET /src/components/ade/ProcessDetail.tsx 200 2ms",
      "2:40:41 PM GET /src/components/ade/ProcessList.tsx 200 2ms",
      "2:40:42 PM [vite] hmr update /src/styles.css",
      "2:41:03 PM GET /api/projects/2b6f/processes 200 3ms",
      "2:41:09 PM GET /api/processes/0c7a/output?after=902 200 1ms",
      "2:41:15 PM POST /api/processes/0c7a/stop 202 4ms",
      "2:41:15 PM Stop requested. Waiting for the agent to acknowledge.",
      "2:41:16 PM The agent is busy with a turn; the stop will run after it.",
      "2:41:24 PM GET /api/projects/2b6f/processes 200 2ms",
      "2:41:30 PM [vite] hmr update /src/components/ade/StatusPill.tsx",
      "2:41:46 PM GET /api/bootstrap 200 5ms",
      "2:41:52 PM GET /api/processes/0c7a/output?after=931 200 1ms",
      "2:42:04 PM [vite] page reload src/routes/processes.tsx",
      "2:42:11 PM GET /src/routes/processes.tsx 200 1ms",
      "2:42:18 PM GET /api/projects/2b6f/processes 200 2ms",
      "2:42:31 PM [vite] hmr update /src/components/ade/SectionTabs.tsx",
      "2:42:40 PM GET /api/processes/0c7a/output?after=968 200 2ms",
      "2:42:52 PM [vite] hmr update /src/styles.css",
      "2:43:10 PM GET /api/processes/0c7a/output?after=1002 200 1ms",
    ],
    p3: [
      "$ node --test --watch",
      "",
      "▶ first-steps-forward",
      "  ✔ bootstrap payload keeps processes without output (12.4ms)",
      "  ✔ dev server start allocates a loopback port (44.8ms)",
      "  ✔ dev server stop is idempotent (9.1ms)",
      "  ✔ process list groups by session id (3.2ms)",
      "  ✔ output reader resumes after a line number (1.8ms)",
      "  ✔ stop all leaves the agent's turn running (6.4ms)",
      "",
      "ℹ tests 6",
      "ℹ pass 6",
      "ℹ fail 0",
      "ℹ duration_ms 118.42",
      "",
      "Waiting for file changes…",
      "press h + enter to show help, q + enter to quit",
    ],
    p2: [
      "$ npm run storybook",
      "",
      "> first-steps-forward@0.1.13 storybook",
      "> storybook dev -p 6006 --no-open",
      "",
      "storybook v9.1.2",
      "",
      "  ➜  Local:   http://127.0.0.1:6006/",
      "  ➜  Network: use --host to expose",
      "",
      "2:24:06 PM [storybook] 6 stories found",
      "2:24:12 PM [storybook] manager ready in 2.1 s",
      "2:24:19 PM [storybook] preview built in 3.4 s",
      "2:31:40 PM [storybook] watching for changes in src/**/*.stories.tsx",
      "2:33:12 PM [storybook] no changes since last build",
      "",
      "The last line arrived 9 minutes ago.",
    ],
  };

  const LONG_LINE =
    "2:43:10 PM [vite] hmr update /src/components/ade/AgentComputerPane.tsx (x12)  GET /api/projects/2b6f47b6-cb9e-472d-8ba2-7a7bb52b0004/browser/stream 200 14ms — keep-alive 5s — clients 1 — frame 1440×900 — profile Default — note the address alone is longer than the panel and has to wrap or scroll";

  function baseProcess(id, overrides) {
    return {
      id,
      conversationId: "c1",
      name: "Development server",
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      bin: "npm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
      port: 5173,
      host: "127.0.0.1",
      status: "running",
      startedAt: "started 4 min ago",
      source: "package.json dev script",
      pid: 48213,
      ...overrides,
    };
  }

  /** The same three processes, adjusted for the scenario control. */
  function scenarioProcesses(scenario) {
    if (scenario === "empty") return [];
    const p1 = baseProcess("p1", {});
    const p2 = baseProcess("p2", {
      conversationId: "c1",
      name: "Storybook",
      command: "npm run storybook",
      bin: "npm",
      args: ["run", "storybook"],
      port: 6006,
      status: "unverified",
      startedAt: "started 12 min ago",
      source: "package.json script",
      pid: 48302,
    });
    const p3 = baseProcess("p3", {
      conversationId: "c2",
      name: "Test watcher",
      command: "node --test --watch",
      bin: "node",
      args: ["--test", "--watch"],
      port: null,
      status: "running",
      startedAt: "started 26 min ago",
      source: "approved command",
      cwd: "scripts",
      pid: 47990,
    });
    p1.conversationId = "c1";
    if (scenario === "checking") {
      p1.status = "unverified";
      p2.status = "unverified";
    }
    if (scenario === "starting") {
      p1.status = "starting";
      p1.port = null;
      p1.startedAt = "starting…";
    }
    if (scenario === "failing") {
      p2.status = "failed";
      p2.stopError =
        "The agent that started it is no longer running. Start the agent again, then retry.";
    }
    return [p1, p2, p3];
  }

  const STATUS = {
    running: { label: "Running", tone: "ok" },
    starting: { label: "Starting…", tone: "wait" },
    stopping: { label: "Stop requested…", tone: "wait" },
    unverified: { label: "Needs checking", tone: "warn" },
    failed: { label: "Couldn't stop", tone: "bad" },
    stopped: { label: "Stopped", tone: "muted" },
  };

  /** Lines for one process, in the workshop's short or long variant. */
  function outputOf(proc, lines = "short") {
    const base = OUTPUT[proc.id] || ["(no output recorded)"];
    if (lines === "long" && proc.id === "p1") {
      const copy = base.slice();
      copy[copy.length - 1] = LONG_LINE;
      return copy;
    }
    return base;
  }

  function addressOf(proc) {
    if (!proc.port) return null;
    return `${proc.host || "127.0.0.1"}:${proc.port}`;
  }

  function urlOf(proc) {
    return proc.port ? `http://${addressOf(proc)}/` : null;
  }

  function matches(proc, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const conversation = CONVERSATIONS.find((c) => c.id === proc.conversationId);
    return [proc.name, proc.command, addressOf(proc) || "", proc.source, conversation?.title || ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
  }

  /** Groups that survive the search, under the conversation that started them. */
  function groups(processes, query) {
    return CONVERSATIONS.map((conversation) => ({
      conversation,
      processes: processes.filter((p) => p.conversationId === conversation.id && matches(p, query)),
    })).filter((group) => group.processes.length);
  }

  function checks(processes) {
    return processes.filter((p) => p.status === "unverified").length;
  }

  function statusMeta(status) {
    return STATUS[status] || STATUS.running;
  }

  /** Mutate state for a scenario change. Options call this in mount and update. */
  function hydrate(state) {
    if (state.scenarioKey === state.scenario) return;
    state.processes = scenarioProcesses(state.scenario);
    state.scenarioKey = state.scenario;
    state.selected = state.processes[0]?.id ?? null;
    state.query = "";
    state.notice = null;
    state.confirmStopAll = false;
    state.stopping = [];
  }

  function stopProcess(state, id) {
    const proc = state.processes.find((p) => p.id === id);
    if (!proc) return null;
    if (state.scenario === "failing" || proc.status === "failed") {
      proc.status = "failed";
      proc.stopError =
        proc.stopError ||
        "The agent that started it is no longer running. Start the agent again, then retry.";
      return { removed: false, proc };
    }
    proc.status = "stopping";
    proc.stoppedAt = "just now";
    return { removed: true, proc };
  }

  function markGood(state, id) {
    const proc = state.processes.find((p) => p.id === id);
    if (proc && proc.status === "unverified") proc.status = "running";
    return proc;
  }

  function markAllGood(state) {
    let count = 0;
    for (const proc of state.processes) {
      if (proc.status === "unverified") {
        proc.status = "running";
        count += 1;
      }
    }
    return count;
  }

  /** One process row: dot, name, meta line. The address + Open is optional chrome. */
  function row(proc, { selected = false, compact = false, open = false } = {}) {
    const meta = statusMeta(proc.status);
    const address = addressOf(proc);
    const canOpen = open && proc.status === "running" && address;
    return `<div class="m-prow${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}">
      <button type="button" class="m-prow-hit" data-focus="row-${proc.id}" data-act="select"
        data-id="${proc.id}" aria-pressed="${selected}">
        <span class="m-prow-dot"><span class="m-dot" data-tone="${meta.tone}"></span></span>
        <span class="m-prow-main">
          <span class="m-prow-name m-truncate">${proc.name}</span>
          <span class="m-prow-meta">
            <span class="m-prow-addr">${address || "No website"}</span>
            ${
              proc.status === "running"
                ? ""
                : `<span class="m-prow-flag" data-tone="${meta.tone}">${meta.label}</span>`
            }
          </span>
        </span>
      </button>
      ${
        canOpen
          ? `<button type="button" class="m-prow-open" data-act="open" data-id="${proc.id}"
              data-focus="open-${proc.id}" aria-label="Open ${address}" title="Open ${address}">${icons.external}</button>`
          : ""
      }
    </div>`;
  }

  function conversationHead(conversation, extra = "") {
    return `<div class="m-convhead">
      <span class="m-convhead-title m-truncate">${conversation.title}</span>
      <span class="m-convhead-meta">${extra || conversation.agent}</span>
    </div>`;
  }

  /** The ADE chrome every option renders inside. */
  function chrome(active, count = 3, adeTab = false) {
    return `<header class="m-topbar">
      <span class="m-brand">ADE</span>
      <nav class="m-projects" aria-label="Projects (mock)">
        <span class="m-project" aria-current="page"><span class="m-project-initial">A</span><span class="m-truncate">first-steps-forward</span></span>
        <span class="m-project"><span class="m-project-initial">P</span><span class="m-truncate">portfolio-site</span></span>
      </nav>
      <div class="m-topbar-right"><span>Projects</span><span>${icons.settings}</span><span>${icons.moon}</span></div>
    </header>
    <nav class="m-sections" aria-label="Project sections (mock)">
      ${
        active === "conversations"
          ? `<span class="m-section" aria-current="page">Conversations</span>`
          : `<span class="m-section">Conversations</span>`
      }
      <span class="m-section">Files</span>
      <span class="m-section">Workflows</span>
      <span class="m-section">Skills</span>
      ${
        active === "processes"
          ? `<span class="m-section" aria-current="page">Processes</span>`
          : adeTab
            ? `<span class="m-section">Processes</span>`
            : ""
      }
    </nav>`;
  }

  /** A conversation mock for options that show the rail or the message box. */
  function conversationBody(state) {
    const proc = state?.processes?.find((item) => item.id === "p1");
    const live = proc && (proc.status === "running" || proc.status === "unverified");
    const processChips = proc
      ? `<div class="m-msg-actions">
          <button type="button" class="m-proc-chip" data-act="run-inline" data-focus="run-inline"
            aria-label="${proc.status === "running" ? "Already running npm run dev" : live ? "Check npm run dev" : "Run npm run dev"}">
            <span class="m-dot" data-tone="${statusMeta(proc.status).tone}"></span>
            ${live ? icons.terminal : icons.play}
            <span>npm run dev</span>
          </button>
          ${
            proc.status === "running"
              ? `<button type="button" class="m-proc-chip is-link" data-act="open-inline" data-focus="open-inline"
                  aria-label="Open 127.0.0.1:5173">${icons.globe}<span>127.0.0.1:5173</span></button>`
              : ""
          }
        </div>`
      : "";
    return `<div class="m-convbody">
      <div class="m-convtitle"><h1>Add a booking flow</h1><span class="m-pill">Claude Code</span></div>
      <div class="m-scroll m-msgs">
        <div class="m-msg-user">Add a booking flow with a date picker, and keep the existing checkout totals.</div>
        <div class="m-msg-agent">
          <p>I added the flow and started the dev server so you can try it.</p>
          ${processChips}
        </div>
        <div class="m-msg-agent"><p>The date picker now handles a missing end date. Want me to add a test for that?</p></div>
      </div>
      <div class="m-composer">
        <div class="m-composer-input">Describe a change</div>
        <div class="m-composer-bar">
          <span class="m-composer-processes"><span class="m-dot" data-tone="ok"></span>2 processes</span>
          <span class="m-kbd">⌘↵</span>
          <span class="m-composer-send">${icons.play}</span>
        </div>
      </div>
    </div>`;
  }

  const mock = {
    icons,
    conversations: CONVERSATIONS,
    statusMeta,
    addressOf,
    urlOf,
    outputOf,
    matches,
    groups,
    checks,
    hydrate,
    stopProcess,
    markGood,
    markAllGood,
    scenarioProcesses,
    row,
    conversationHead,
    chrome,
    conversationBody,
    emptyState() {
      return `<div class="m-empty-state">
        <span class="m-empty-icon">${icons.terminal}</span>
        <h3>Nothing running yet</h3>
        <p>When an agent starts a server or a watcher, it appears here with its output and a Stop button.</p>
        <span class="m-pill">Ask the agent to start the site</span>
      </div>`;
    },
    notice(text, tone) {
      return text
        ? `<div class="m-notice" data-tone="${tone || "info"}" role="status">${
            tone === "error" ? icons.alert : icons.check
          }<span>${text}</span></div>`
        : "";
    },
    confirmDialog(processes) {
      const count = processes.length;
      return `<div class="m-scrim"><div class="m-dialog" role="dialog" aria-modal="true" aria-labelledby="stop-all-title">
        <div class="m-dialog-head">
          <div><h2 id="stop-all-title">Stop all processes?</h2>
          <p>${count} ${count === 1 ? "process stops" : "processes stop"}. The conversations that started them keep running, and you can ask an agent to start them again.</p></div>
        </div>
        <div class="m-dialog-body">
          <div class="m-dialog-list">${processes
            .map(
              (proc) =>
                `<div class="m-dialog-row"><span class="m-dot" data-tone="${statusMeta(proc.status).tone}"></span><span>${proc.name}</span></div>`,
            )
            .join("")}</div>
        </div>
        <div class="m-dialog-foot">
          <button type="button" class="m-btn m-btn-quiet" data-act="cancel-stop-all">Cancel</button>
          <button type="button" class="m-btn m-btn-danger" data-act="confirm-stop-all" data-focus="confirm-stop-all">Stop ${count} processes</button>
        </div>
      </div></div>`;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Registry and shell                                                  */
  /* ------------------------------------------------------------------ */

  const WS = {};
  const options = new Map();
  const states = new Map();
  const FRAME_WIDTH = 1280;
  const FRAME_HEIGHT = 720;
  const DEFAULT_STATE = {
    scenario: "mixed",
    mockTheme: "light",
    outputLines: "short",
    scenarioKey: null,
    processes: [],
    selected: null,
    query: "",
    wrap: true,
    follow: true,
    notice: null,
    confirmStopAll: false,
  };

  WS.icon = (name) => icons[name] || "";

  WS.register = function (option) {
    options.set(option.id, option);
  };

  WS.renderKeepFocus = function (el, html) {
    const active = document.activeElement;
    const key = active && el.contains(active) ? active.getAttribute("data-focus") : null;
    el.innerHTML = html;
    if (key) el.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
  };

  WS.mock = mock;
  WS.icons = icons;

  window.WS = window.WS || WS;

  function stateFor(option) {
    if (!states.has(option.id)) {
      states.set(option.id, { ...DEFAULT_STATE, ...(option.initialState?.() || {}) });
    }
    return states.get(option.id);
  }

  function injectCss(option) {
    if (!option.css || document.getElementById(`opt-css-${option.id}`)) return;
    const style = document.createElement("style");
    style.id = `opt-css-${option.id}`;
    style.textContent = option.css;
    document.head.appendChild(style);
  }

  function mountInstance(option, root, { kind, getState, setState, patch, onReport, mountFn }) {
    root.classList.add("mock", `opt-${option.id}`);
    root.dataset.mockTheme = getState().mockTheme;
    const ctx = {
      kind,
      getState,
      setState,
      patch,
      icons,
      mock,
      report: onReport || (() => {}),
    };
    const fn = mountFn || option.mount;
    const inst = (fn ? fn.call(option, root, ctx) : null) || {};
    const handle = {
      update() {
        root.dataset.mockTheme = getState().mockTheme;
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

  const $ = (sel, root = document) => root.querySelector(sel);
  const live = [];
  let resizeObs = null;

  function teardown() {
    while (live.length) live.pop().destroy();
    resizeObs?.disconnect();
    resizeObs = null;
  }

  function orderedOptions() {
    return [...options.values()].sort((a, b) => a.id - b.id);
  }

  function renderOverview() {
    teardown();
    $("#view-overview").hidden = false;
    $("#view-option").hidden = true;
    const grid = $("#overview-grid");
    grid.replaceChildren();
    for (const o of orderedOptions()) {
      injectCss(o);
      const card = document.createElement("article");
      card.className = "ov-card";
      card.innerHTML = `
        <a class="ov-thumb" href="#option-${o.id}" aria-label="Open option ${o.id}, ${o.name}">
          <div class="ov-thumb-frame"><div class="ov-thumb-mount"></div></div>
        </a>
        <div class="ov-meta">
          <div class="ov-num">Option ${o.id}${o.chosen ? " · Chosen" : ""}</div>
          <h3><a href="#option-${o.id}">${o.name}</a></h3>
          <p>${o.tradeoff}</p>
        </div>`;
      grid.appendChild(card);
      const thumbState = stateFor(o);
      mock.hydrate(thumbState);
      const frame = $(".ov-thumb-frame", card);
      const mountEl = $(".ov-thumb-mount", card);
      mountEl.style.width = `${FRAME_WIDTH}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      live.push(
        mountInstance(o, mountEl, {
          kind: "thumb",
          getState: () => thumbState,
          setState: () => {},
          patch: () => {},
        }),
      );
      const fit = () => {
        const s = frame.clientWidth / FRAME_WIDTH;
        mountEl.style.transform = `scale(${s})`;
        frame.style.height = `${FRAME_HEIGHT * s}px`;
      };
      fit();
      (resizeObs ||= new ResizeObserver(() => frame._fit?.())).observe(frame);
      frame._fit = fit;
    }
  }

  function renderOption(id) {
    const o = options.get(id);
    if (!o) return renderOverview();
    teardown();
    injectCss(o);
    $("#view-overview").hidden = true;
    $("#view-option").hidden = false;

    const list = orderedOptions();
    const idx = list.indexOf(o);
    const prev = list[(idx - 1 + list.length) % list.length];
    const next = list[(idx + 1) % list.length];
    $("#opt-prev").href = `#option-${prev.id}`;
    $("#opt-prev").textContent = `‹ ${prev.id}. ${prev.name}`;
    $("#opt-next").href = `#option-${next.id}`;
    $("#opt-next").textContent = `${next.id}. ${next.name} ›`;
    $("#opt-jump").innerHTML = list
      .map(
        (x) =>
          `<a href="#option-${x.id}" ${x === o ? 'aria-current="page"' : ""} title="${x.name}">${x.id}</a>`,
      )
      .join("");
    $("#opt-eyebrow").textContent = `Option ${o.id}${o.chosen ? " · Chosen" : ""}`;
    $("#opt-title").textContent = o.name;
    $("#opt-tradeoff").textContent = o.tradeoff;
    $("#opt-notes").innerHTML = (o.notes || []).map((n) => `<li>${n}</li>`).join("");

    const state = stateFor(o);
    mock.hydrate(state);
    const stage = $("#stage");
    const frame = $("#stage-frame");
    const mountEl = document.createElement("div");
    frame.replaceChildren(mountEl);
    let scale = 1;

    const fit = () => {
      scale = Math.min(1, stage.clientWidth / FRAME_WIDTH);
      mountEl.style.width = `${FRAME_WIDTH}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      mountEl.style.transform = `scale(${scale})`;
      frame.style.width = `${FRAME_WIDTH * scale}px`;
      frame.style.height = `${FRAME_HEIGHT * scale}px`;
      $("#scale-note").textContent =
        scale < 1 ? `Shown at ${Math.round(scale * 100)}% to fit` : "Shown at 100%";
    };

    const syncControls = () => {
      document.querySelectorAll("#ctl-scenario button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.scenario));
      });
      document.querySelectorAll("#ctl-theme button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.mockTheme));
      });
      document.querySelectorAll("#ctl-lines button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.outputLines));
      });
    };

    let reported = "";
    const setState = (partial) => {
      Object.assign(state, partial);
      syncControls();
      for (const inst of live) inst.update();
    };
    const patch = (partial) => {
      Object.assign(state, partial);
    };

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

    const closeups = $("#closeups");
    closeups.replaceChildren();
    for (const cu of o.closeups || []) {
      const fig = document.createElement("figure");
      fig.className = "closeup";
      fig.innerHTML = `<figcaption>${cu.label}</figcaption><div class="closeup-box"></div>`;
      closeups.appendChild(fig);
      live.push(
        mountInstance(o, $(".closeup-box", fig), {
          kind: "closeup",
          getState: () => state,
          setState,
          patch,
          mountFn: cu.mount,
        }),
      );
    }

    $("#ctl-scenario").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      states.delete(o.id);
      const fresh = stateFor(o);
      fresh.scenario = b.dataset.v;
      fresh.mockTheme = state.mockTheme;
      fresh.outputLines = state.outputLines;
      renderOption(id);
    };
    $("#ctl-theme").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ mockTheme: b.dataset.v });
    };
    $("#ctl-lines").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ outputLines: b.dataset.v });
    };
    $("#ctl-reset").onclick = () => {
      states.delete(o.id);
      const fresh = stateFor(o);
      fresh.scenario = state.scenario;
      fresh.mockTheme = state.mockTheme;
      fresh.outputLines = state.outputLines;
      renderOption(id);
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
