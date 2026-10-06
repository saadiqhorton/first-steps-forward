/* Responsive panels workshop: option registry, shared mock content, and the
 * comparison shell. Options live in options/*.js and call WS.register(). */
(function () {
  "use strict";

  const svg = (body) =>
    `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

  // Lucide icon paths (the app uses lucide-react).
  const icons = {
    monitor: svg('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>'),
    play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    branch: svg('<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
    paperclip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    arrowUp: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
    terminal: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>'),
    activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    diff: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    panelClose: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>'),
    panelOpen: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>'),
    settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    loader: svg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),
    chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
    expand: svg('<path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"/><path d="M3 16.2V21m0 0h4.8M3 21l6-6"/><path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"/><path d="M3 7.8V3m0 0h4.8M3 3l6 6"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  };

  const PROJECT = "sticky-note-dashboard";

  // Real copy from src/local/workflows.mjs and AgentComputerPane.tsx.
  const workflows = [
    { name: "Design Workshop", description: "Explore three to five different directions for an interface, then build a comparison page." },
    { name: "Explain this codebase", description: "Write a practical introduction to this codebase for a new teammate." },
    { name: "Plan the next feature", description: "Turn my feature request into an implementation plan grounded in this repository." },
  ];

  const computerCopy = {
    off: {
      tone: "idle",
      badge: "stopped",
      title: "Computer is off",
      description: "Start this project's computer when you want to watch the agent run and test its work.",
      footerLeft: "1280 × 800",
      footerRight: "ready when you are",
      action: "Start computer",
      hint: "The task stays beside the computer. When the agent starts it, its real desktop and browser appear here.",
    },
    starting: {
      tone: "busy",
      badge: "starting",
      title: "Starting the computer",
      description: "The desktop is starting. Its screen will appear here when ready.",
      footerLeft: "1280 × 800",
      footerRight: "setting up",
      action: null,
      hint: "The task stays beside the computer. When the agent starts it, its real desktop and browser appear here.",
    },
    live: {
      tone: "live",
      badge: "live",
      title: "Computer is live",
      description: "",
      footerLeft: "1280 × 800",
      footerRight: "view only",
      action: null,
      hint: "The agent starts the app, opens it here, and tests it like a person would. Watch live, or take control to help.",
    },
    error: {
      tone: "error",
      badge: "error",
      title: "Computer needs attention",
      description: "The last start attempt did not finish. Review the setup details and try again.",
      footerLeft: "1280 × 800",
      footerRight: "ready when you are",
      action: "Try starting again",
      hint: "The task stays beside the computer. When the agent starts it, its real desktop and browser appear here.",
    },
  };

  const rightTabs = [
    { id: "activity", label: "Activity", icon: icons.activity },
    { id: "diff", label: "Diff", icon: icons.diff },
    { id: "computer", label: "Computer", icon: icons.monitor },
    { id: "terminal", label: "Terminal", icon: icons.terminal },
  ];

  const details = [
    { label: "Checks", value: "2 of 2 passed", ok: true },
    { label: "Working tree diff", value: "+42 / −9" },
    { label: "Agent output", value: "318 lines" },
  ];

  const mock = {
    project: PROJECT,
    workflows,
    computerCopy,
    rightTabs,
    details,

    topBar() {
      return `<header class="m-topbar">
        <span class="m-brand">ADE</span>
        <nav class="m-projects" aria-label="Projects (mock)">
          <span class="m-project" aria-current="page"><span class="m-project-initial">S</span><span class="m-truncate">${PROJECT}</span></span>
          <span class="m-project"><span class="m-project-initial">P</span><span class="m-truncate">portfolio-site</span></span>
        </nav>
        <div class="m-topbar-right"><span>Projects ${icons.chevronDown}</span><span>${icons.settings}</span><span>${icons.moon}</span></div>
      </header>`;
    },

    sectionTabs() {
      return `<nav class="m-sections" aria-label="Project sections (mock)">
        <span class="m-section" aria-current="page">Conversations</span>
        <span class="m-section">Files</span>
        <span class="m-section">Workflows</span>
      </nav>`;
    },

    conversationList() {
      const items = [
        ["Fix sticky note drag on Safari", "working · 4m"],
        ["Add color picker to notes", "needs review · 1h"],
        ["Persist board layout", "done · yesterday"],
      ];
      return `<aside class="m-conv" aria-label="Conversations (mock)">
        <div class="m-conv-head"><span class="m-label-mono">Conversations</span><span class="m-conv-new m-btn-quiet">${icons.plus}New</span></div>
        ${items
          .map(
            ([t, s], i) =>
              `<div class="m-conv-item" ${i === 0 ? 'aria-current="true"' : ""}><span class="m-truncate">${t}</span><small>${s}</small></div>`,
          )
          .join("")}
      </aside>`;
    },

    /** The New Task screen (NewTaskForm.tsx) with workflow cards and the composer. */
    newTask() {
      return `<main class="m-task">
        <div class="m-task-inner">
          <h1>What are you working on?</h1>
          <p class="m-task-sub">Describe a change and an agent gets started.</p>
          <div class="m-label-mono m-task-label">Start with a workflow</div>
          <div class="m-cards">
            ${workflows
              .map(
                (w) => `<button type="button" class="m-card m-wcard">
                  <span class="m-wcard-title"><span>${w.name}</span>${icons.play}</span>
                  <p>${w.description}</p>
                </button>`,
              )
              .join("")}
          </div>
          <div class="m-browse">Browse all workflows →</div>
          <div class="m-composer">
            <div class="m-composer-input">Describe the change you want…</div>
            <div class="m-composer-foot">
              <span class="m-agent-chip m-btn-quiet"><b class="m-truncate">Claude Code</b><small class="m-truncate">claude-opus-5-5 · high</small></span>
              <span class="m-branch">${icons.branch}<span class="m-truncate">main</span></span>
              <span class="m-composer-actions">
                <span class="m-icon-btn m-btn-quiet" aria-label="Attach">${icons.paperclip}</span>
                <span class="m-icon-btn m-btn-amber" aria-label="Send">${icons.arrowUp}</span>
              </span>
            </div>
          </div>
        </div>
      </main>`;
    },

    /** Conversation list + New Task view, as the main panel shows today. */
    mainPanel({ withList = true } = {}) {
      return `<div class="m-mainpanel">${withList ? mock.conversationList() : ""}${mock.newTask()}</div>`;
    },

    activityBody() {
      const rows = [
        [icons.file, "Read src/components/NoteCard.tsx", "4m"],
        [icons.terminal, "Ran npm test — 12 passed", "3m", true],
        [icons.diff, "Edited src/hooks/useDrag.ts (+18 −4)", "3m"],
        [icons.monitor, "Opened http://localhost:5173 on the agent computer", "2m"],
        [icons.check, "Checks: typecheck, unit tests", "1m", true],
      ];
      return `<div class="m-activity">${rows
        .map(
          ([ic, text, t, ok]) =>
            `<div class="m-activity-row" ${ok ? 'data-ok="true"' : ""}>${ic}<span>${text}</span><time>${t}</time></div>`,
        )
        .join("")}</div>`;
    },

    diffBody() {
      return `<div>
        <div class="m-diff-file"><span class="name">src/hooks/useDrag.ts</span><span class="add">+18</span><span class="del">−4</span></div>
        <pre class="m-diff-code"><span class="d">-  const onMove = (e) =&gt; setPos({ x: e.pageX, y: e.pageY });</span>
<span class="a">+  const onMove = (e: PointerEvent) =&gt; {</span>
<span class="a">+    e.preventDefault();</span>
<span class="a">+    setPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });</span>
<span class="a">+  };</span></pre>
        <div class="m-diff-file"><span class="name">src/components/NoteCard.tsx</span><span class="add">+21</span><span class="del">−5</span></div>
        <div class="m-diff-file"><span class="name">src/styles/board.css</span><span class="add">+3</span><span class="del">−0</span></div>
      </div>`;
    },

    terminalBody() {
      return `<pre class="m-terminal"><span class="p">~/${PROJECT} $</span> npm run dev

  VITE v6.3.5  ready in 412 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
<span class="p">~/${PROJECT} $</span> </pre>`;
    },

    /** A fake desktop for the live Computer state (fills its container). */
    liveScreen() {
      return `<div class="m-desktop"><div class="m-desktop-win">
          <span class="m-desktop-note" style="left:8%;top:18%;background:#f7d774"></span>
          <span class="m-desktop-note" style="left:38%;top:24%;background:#9fd8c4"></span>
          <span class="m-desktop-note" style="left:68%;top:16%;background:#f2a9a0"></span>
          <span class="m-desktop-note" style="left:20%;top:58%;background:#b9c8f5"></span>
        </div><span class="m-desktop-dock"></span></div>`;
    },

    statusPill(computer) {
      const c = computerCopy[computer];
      return `<span class="m-pill" data-tone="${c.tone}">${c.badge}</span>`;
    },

    detailsRows() {
      return details
        .map(
          (d) =>
            `<div class="m-details-row"><span>${d.label}</span><span ${d.ok ? 'data-ok="true"' : ""}>${d.value}</span></div>`,
        )
        .join("");
    },
  };

  /* ------------------------------------------------------------------ */
  /* Registry + state                                                    */
  /* ------------------------------------------------------------------ */

  const VIEWPORTS = [768, 1024, 1280, 1600];
  const FRAME_HEIGHT = 680;
  const DEFAULT_STATE = Object.freeze({
    viewport: 1280,
    rightWidth: 300,
    computer: "off",
    tab: "computer",
    mockTheme: "dark",
    rightOpen: true,
  });
  const CLOSEUP_WIDTHS = [240, 320, 480];

  const options = new Map();
  const states = new Map();

  const WS = {
    icons,
    mock,
    VIEWPORTS,
    FRAME_HEIGHT,
    DEFAULT_STATE,
    register(option) {
      options.set(option.id, option);
    },
    /** Replace el's markup, then restore focus to the element with the same data-focus key. */
    renderKeepFocus(el, html) {
      const active = document.activeElement;
      const key = active && el.contains(active) ? active.getAttribute("data-focus") : null;
      el.innerHTML = html;
      if (key) el.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
    },
  };
  window.WS = WS;

  function stateFor(id) {
    if (!states.has(id)) states.set(id, { ...DEFAULT_STATE });
    return states.get(id);
  }

  function injectCss(option) {
    if (!option.css || document.getElementById(`opt-css-${option.id}`)) return;
    const style = document.createElement("style");
    style.id = `opt-css-${option.id}`;
    style.textContent = option.css;
    document.head.appendChild(style);
  }

  /**
   * Mount one option instance. `getState` / `setState` define its isolated state;
   * `scale` is the CSS transform applied to the frame so sashes can convert pointer
   * deltas to mock pixels.
   */
  function mountInstance(option, root, { kind, getState, setState, scale = () => 1, onReport }) {
    root.classList.add("mock", `opt-${option.id}`);
    root.dataset.mockTheme = getState().mockTheme;
    const ctx = {
      kind, // "full" | "panel" | "thumb"
      getState,
      setState,
      icons,
      mock,
      scale,
      report: onReport || (() => {}),
      attachSash(el, opts = {}) {
        return attachSash(el, ctx, opts);
      },
    };
    const fn = kind === "panel" ? option.mountPanel : option.mount;
    const inst = fn.call(option, root, ctx) || {};
    return {
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
  }

  /** Drag/keyboard behaviour for a seam that sizes the right panel. */
  function attachSash(el, ctx, { side = "right", onEnd } = {}) {
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", "vertical");
    el.setAttribute("aria-label", "Resize right panel");
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    const sign = side === "right" ? -1 : 1;
    let startX = 0;
    let startW = 0;
    let dragging = false;
    const onDown = (e) => {
      if (e.target !== el) return; // let buttons inside the seam work
      dragging = true;
      startX = e.clientX;
      startW = ctx.getState().rightWidth;
      el.setPointerCapture(e.pointerId);
      el.dataset.dragging = "true";
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startX) / ctx.scale();
      const vp = ctx.getState().viewport;
      ctx.setState({ rightWidth: Math.round(Math.max(0, Math.min(vp, startW + sign * dx))) });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      onEnd?.(ctx.getState());
    };
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 80 : 20;
      const delta = (e.key === "ArrowLeft" ? 1 : -1) * -sign * step;
      const vp = ctx.getState().viewport;
      ctx.setState({ rightWidth: Math.max(0, Math.min(vp, ctx.getState().rightWidth + delta)) });
      onEnd?.(ctx.getState());
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("keydown", onKey);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shell UI                                                            */
  /* ------------------------------------------------------------------ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const live = []; // mounted instances on the current view
  let resizeObs = null;

  function teardown() {
    while (live.length) live.pop().destroy();
    resizeObs?.disconnect();
    resizeObs = null;
  }

  function orderedOptions() {
    return [...options.values()].sort((a, b) => a.id - b.id);
  }

  function optionLabel(o) {
    return o.id === 0 ? "Today" : String(o.id);
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
        <a class="ov-thumb" href="#option-${o.id}" aria-label="Open ${o.id === 0 ? "today's layout" : `option ${o.id}, ${o.name}`}">
          <div class="ov-thumb-frame"><div class="ov-thumb-mount"></div></div>
        </a>
        <div class="ov-meta">
          <div class="ov-num">${o.id === 0 ? "Today" : `Option ${o.id}`}</div>
          <h3><a href="#option-${o.id}">${o.name}</a></h3>
          <p>${o.tradeoff}</p>
        </div>`;
      grid.appendChild(card);
      const thumbState = { ...DEFAULT_STATE, viewport: 1280, rightWidth: 260 };
      const frame = $(".ov-thumb-frame", card);
      const mountEl = $(".ov-thumb-mount", card);
      mountEl.style.width = `${thumbState.viewport}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      const inst = mountInstance(o, mountEl, {
        kind: "thumb",
        getState: () => thumbState,
        setState: () => {},
      });
      live.push(inst);
      const fit = () => {
        const s = frame.clientWidth / thumbState.viewport;
        mountEl.style.transform = `scale(${s})`;
        frame.style.height = `${FRAME_HEIGHT * s}px`;
      };
      fit();
      (resizeObs ||= new ResizeObserver((entries) => entries.forEach((e) => e.target._fit?.()))).observe(frame);
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
    $("#opt-prev").textContent = `‹ ${prev.id === 0 ? "Today" : `${prev.id}. ${prev.name}`}`;
    $("#opt-next").href = `#option-${next.id}`;
    $("#opt-next").textContent = `${next.id === 0 ? "Today" : `${next.id}. ${next.name}`} ›`;
    $("#opt-jump").innerHTML = list
      .map(
        (x) =>
          `<a href="#option-${x.id}" ${x === o ? 'aria-current="page"' : ""} title="${x.name}">${optionLabel(x)}</a>`,
      )
      .join("");
    $("#opt-eyebrow").textContent = o.id === 0 ? "Today · baseline" : `Option ${o.id}`;
    $("#opt-title").textContent = o.name;
    $("#opt-tradeoff").textContent = o.tradeoff;
    $("#opt-notes").innerHTML = (o.notes || []).map((n) => `<li>${n}</li>`).join("");

    const state = stateFor(id);
    const stage = $("#stage");
    const frame = $("#stage-frame");
    const mountEl = document.createElement("div");
    frame.replaceChildren(mountEl);
    let scale = 1;
    const readout = $("#readout");

    const fit = () => {
      scale = Math.min(1, stage.clientWidth / state.viewport);
      mountEl.style.width = `${state.viewport}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      mountEl.style.transform = `scale(${scale})`;
      frame.style.width = `${state.viewport * scale}px`;
      frame.style.height = `${FRAME_HEIGHT * scale}px`;
      $("#scale-note").textContent =
        scale < 1 ? `Shown at ${Math.round(scale * 100)}% to fit` : "Shown at 100%";
    };

    const syncControls = () => {
      document.querySelectorAll("#ctl-viewport button").forEach((b) => {
        b.setAttribute("aria-pressed", String(Number(b.dataset.v) === state.viewport));
      });
      document.querySelectorAll("#ctl-computer button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.computer));
      });
      document.querySelectorAll("#ctl-theme button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.mockTheme));
      });
      const slider = $("#ctl-width");
      slider.max = String(Math.min(900, state.viewport));
      slider.value = String(state.rightWidth);
      $("#ctl-width-out").textContent = `${state.rightWidth}px`;
    };

    let reported = "";
    const setState = (partial) => {
      Object.assign(state, partial);
      if ("viewport" in partial) fit();
      syncControls();
      for (const inst of live) inst.update();
    };

    const main = mountInstance(o, mountEl, {
      kind: "full",
      getState: () => state,
      setState,
      scale: () => scale,
      onReport: (text) => {
        if (text !== reported) readout.textContent = reported = text;
      },
    });
    live.push(main);
    fit();
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(stage);

    // Close-ups: the right panel alone at fixed widths, sharing this option's state.
    const closeups = $("#closeups");
    closeups.replaceChildren();
    if (o.mountPanel) {
      for (const w of CLOSEUP_WIDTHS) {
        const fig = document.createElement("figure");
        fig.className = "closeup";
        fig.innerHTML = `<figcaption>${w}px wide</figcaption><div class="closeup-box" style="width:${w}px"></div>`;
        closeups.appendChild(fig);
        const box = $(".closeup-box", fig);
        live.push(
          mountInstance(o, box, {
            kind: "panel",
            getState: () => ({ ...state, rightWidth: w }),
            setState: (p) => {
              const { rightWidth, ...rest } = p;
              setState(rest);
            },
          }),
        );
      }
    }

    // Controls
    $("#ctl-viewport").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ viewport: Number(b.dataset.v) });
    };
    $("#ctl-computer").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ computer: b.dataset.v, tab: "computer" });
    };
    $("#ctl-theme").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ mockTheme: b.dataset.v });
    };
    $("#ctl-width").oninput = (e) => setState({ rightWidth: Number(e.target.value) });
    $("#ctl-reset").onclick = () => {
      // Remount from scratch so option-internal timers and drafts are cleared too.
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, DEFAULT_STATE);
      renderOption(id);
      $("#ctl-reset").focus();
    };
    readout.textContent = "";
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
