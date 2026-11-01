/* Option 4: Collapse + drawer.
 * The right panel never squeezes below its usable minimum: it collapses to a
 * slim rail of tab icons, and below a 1024px window it becomes an overlay
 * drawer instead of disappearing. See README.md for the option contract. */
WS.register({
  id: 4,
  name: "Collapse + drawer",
  tradeoff:
    "Every window size has a usable layout, including small ones, but it adds a collapsed rail and a drawer mode to maintain.",
  notes: [
    "The right panel has a 300px minimum and a 60% maximum. Dragging it under 300px collapses it to a 40px rail of tab icons instead of squeezing the tabs or the Computer card.",
    "The rail shows a live dot on the <b>Computer</b> icon (teal live, amber starting, red error). Clicking any rail icon reopens the panel at 360px on that tab.",
    "Below a 1024px window, the right panel becomes a drawer that slides over the main panel from the right. A toggle button sits in the top bar's right group; Esc, the scrim, or the close button dismiss it.",
    "The main panel never drops under 480px &mdash; the right panel's rendered width is capped first. Under 720px the conversation list auto-hides behind a small <b>Conversations</b> toggle.",
    "In code: <code>Shell.tsx</code> would move to px-based <code>minSize</code> plus collapse thresholds in <code>react-resizable-panels</code>, with a slim collapsed rail; a <code>Sheet</code>/drawer below 1024px reusing <code>src/components/ui</code>; the conversations layout gets an auto-collapse breakpoint; <code>AgentComputerPane</code> reflows its card instead of clipping.",
  ],
  css: `
    .opt-4 .o4-topbar-wrap { display: contents; }
    .opt-4 .o4-drawer-toggle { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: var(--dim); }
    .opt-4 .o4-drawer-toggle:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); }
    .opt-4 .o4-drawer-toggle[aria-pressed="true"] { color: var(--amber-deep); }
    .opt-4 .o4-drawer-toggle[hidden] { display: none; }

    .opt-4 .o4-main { position: relative; display: flex; flex: 1; min-width: 0; }
    .opt-4 .o4-convtoggle { position: absolute; top: 8px; left: 8px; z-index: 2; padding: 6px 10px; font-size: 12px; border-radius: var(--radius-control); }
    .opt-4 .o4-convtoggle[hidden] { display: none; }
    .opt-4 .o4-main:has(> .o4-convtoggle:not([hidden])) .m-task-inner { padding-top: 56px; }
    .opt-4 .m-conv[hidden] { display: none; }

    .opt-4 .o4-right { flex: none; min-width: 0; display: flex; flex-direction: column; overflow: hidden; border-left: 1px solid var(--line); background: var(--panel); }
    .opt-4 .o4-right[hidden] { display: none; }

    /* Tab strip: scrolls instead of clipping Terminal */
    .opt-4 .o4-tabs { display: flex; flex: none; height: 40px; overflow-x: auto; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-4 .o4-tabs::-webkit-scrollbar { height: 4px; }
    .opt-4 .o4-tab { position: relative; flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; font-size: 13px; color: var(--dim); white-space: nowrap; }
    .opt-4 .o4-tab svg { width: 14px; height: 14px; }
    .opt-4 .o4-tab[aria-selected="true"] { color: var(--ink); }
    .opt-4 .o4-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px; border-radius: 2px; background: var(--amber); }

    /* Collapsed rail */
    .opt-4 .o4-rail { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 12px; }
    .opt-4 .o4-rail-btn { position: relative; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: var(--dim); }
    .opt-4 .o4-rail-btn[aria-selected="true"] { background: color-mix(in oklab, var(--ink) 8%, transparent); color: var(--ink); }
    .opt-4 .o4-rail-dot { position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px; border-radius: 50%; border: 1px solid var(--panel); background: var(--dim); }
    .opt-4 .o4-rail-dot[data-tone="teal"] { background: var(--teal); }
    .opt-4 .o4-rail-dot[data-tone="amber"] { background: var(--amber); }
    .opt-4 .o4-rail-dot[data-tone="red"] { background: var(--danger); }

    /* Computer header + card, reflowed: no fixed-aspect clipping */
    .opt-4 .o4-head { display: flex; height: 44px; flex: none; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--line); }
    .opt-4 .o4-head b { display: block; font-size: 14px; font-weight: 500; }
    .opt-4 .o4-head small { display: block; font-size: 11px; color: var(--dim); }
    .opt-4 .o4-card { margin: 12px; display: flex; flex-direction: column; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; }
    .opt-4 .o4-card-top { aspect-ratio: 16 / 10; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; }
    .opt-4 .o4-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: var(--amber); }
    .opt-4 .o4-icon svg { width: 24px; height: 24px; stroke-width: 1.5; }
    .opt-4 .o4-eyebrow { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: rgba(255,255,255,.45); }
    .opt-4 .o4-card h2 { margin: 8px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
    .opt-4 .o4-card p { margin: 8px auto 0; max-width: 20rem; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,.65); }
    .opt-4 .o4-start { display: inline-flex; align-items: center; gap: 8px; margin-top: 20px; padding: 8px 16px; font-size: 12px; }
    .opt-4 .o4-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 12px; padding: 8px 16px; border-top: 1px solid rgba(255,255,255,.1); font-family: var(--font-mono); font-size: 10px; color: rgba(255,255,255,.45); }
    .opt-4 .o4-hint { margin: 12px 16px 16px; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-4 .o4-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px 16px; }
    .opt-4 .o4-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-4 .o4-details { margin-top: auto; border-top: 1px solid var(--line); }
    .opt-4 .o4-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-4 .o4-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }

    /* Drawer (window < 1024px) */
    .opt-4 .o4-scrim { position: absolute; inset: 0; z-index: 10; background: var(--scrim); opacity: 0; pointer-events: none; transition: opacity .2s ease; }
    .opt-4 .o4-scrim.is-open { opacity: 1; pointer-events: auto; }
    .opt-4 .o4-scrim[hidden] { display: none; }
    .opt-4 .o4-drawer { position: absolute; top: 0; right: 0; bottom: 0; z-index: 11; width: min(420px, 92%); display: flex; flex-direction: column; background: var(--panel); box-shadow: var(--shadow-floating); transform: translateX(100%); transition: transform .2s ease; }
    .opt-4 .o4-drawer.is-open { transform: translateX(0); }
    .opt-4 .o4-drawer[hidden] { display: none; }
    .opt-4 .o4-drawer-head { display: flex; flex: none; align-items: center; justify-content: space-between; height: 44px; padding: 0 12px; border-bottom: 1px solid var(--line); }
    .opt-4 .o4-drawer-close { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; }
    .opt-4 .o4-drawer-close:hover { background: var(--surface-muted); }
    .opt-4 .o4-drawer-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    @media (prefers-reduced-motion: reduce) {
      .opt-4 .o4-drawer, .opt-4 .o4-scrim { transition: none; }
    }
  `,

  /** Today's rendered right-panel width/mode for a given state. */
  layout(state) {
    const vp = state.viewport;
    const seam = 4;
    if (vp < 1024) return { mode: "drawer", width: 0, mainW: vp };
    if (state.rightWidth < 300) return { mode: "rail", width: 40, mainW: vp - 40 - seam };
    const maxRight = vp * 0.6;
    const capForMain = vp - seam - 480; // keep the main panel at 480px minimum
    const width = Math.round(Math.min(maxRight, capForMain, state.rightWidth));
    return { mode: "panel", width, mainW: vp - width - seam };
  },

  /** The right panel's content: tab strip + body. Shared by the full mount,
   *  the drawer, and the close-ups. */
  renderPanel(state, { mock, icons }) {
    const tab = (t) =>
      `<button type="button" role="tab" class="o4-tab" data-tab="${t.id}" data-focus="tab-${t.id}" aria-selected="${state.tab === t.id}">${t.icon}<span>${t.label}</span></button>`;
    let body;
    if (state.tab === "activity") body = `<div class="m-scroll">${mock.activityBody()}</div>`;
    else if (state.tab === "diff") body = `<div class="m-scroll">${mock.diffBody()}</div>`;
    else if (state.tab === "terminal") body = mock.terminalBody();
    else body = this.renderComputer(state, { mock, icons });
    return `<div class="m-right">
      <div class="o4-tabs" role="tablist" aria-label="Right panel (mock)">${mock.rightTabs.map(tab).join("")}</div>
      ${body}
    </div>`;
  },

  renderComputer(state, { mock, icons }) {
    const c = mock.computerCopy[state.computer];
    const screen =
      state.computer === "live"
        ? `<div class="m-screen">${mock.liveScreen()}</div>`
        : `<div class="o4-card">
            <div class="o4-card-top">
              <div class="o4-icon">${state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor}</div>
              <div class="o4-eyebrow">${mock.project} · local desktop</div>
              <h2>${c.title}</h2>
              <p>${c.description}</p>
              ${c.action ? `<button type="button" class="o4-start m-btn-amber" data-act="start" data-focus="act-start">${icons.monitor}${c.action}</button>` : ""}
            </div>
            <div class="o4-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
          </div>`;
    return `<div class="m-scroll" style="display:flex;flex-direction:column">
      <div class="o4-head"><div style="min-width:0"><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>
      <div style="padding-bottom:12px">${screen}</div>
      <p class="o4-hint">${c.hint}</p>
      ${
        state.computer === "live"
          ? `<div class="o4-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop" data-focus="act-stop">Turn off</button></div>`
          : ""
      }
      <div class="o4-details">
        <div class="o4-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
        ${mock.detailsRows()}
      </div>
    </div>`;
  },

  /** The collapsed rail: a vertical stack of tab icons. */
  renderRail(state, { mock }) {
    const tone = mock.computerCopy[state.computer].tone;
    const dot =
      tone === "live" ? "teal" : tone === "busy" ? "amber" : tone === "error" ? "red" : "";
    return `<div class="o4-rail" role="tablist" aria-label="Right panel (collapsed)">
      ${mock.rightTabs
        .map(
          (t) =>
            `<button type="button" class="o4-rail-btn" data-act="rail-open" data-tab="${t.id}" data-focus="rail-${t.id}" aria-selected="${state.tab === t.id}" aria-label="${t.label}">
              ${t.icon}${t.id === "computer" && dot ? `<span class="o4-rail-dot" data-tone="${dot}"></span>` : ""}
            </button>`,
        )
        .join("")}
    </div>`;
  },

  /** Simulated outcomes for tab/start/stop controls inside the panel (mock only). */
  wirePanel(el, ctx) {
    const onClick = (e) => {
      const t = e.target.closest("[data-tab],[data-act]");
      if (!t) return;
      if (t.dataset.tab && !t.dataset.act) ctx.setState({ tab: t.dataset.tab });
      if (t.dataset.act === "start") ctx.setState({ computer: "starting" });
      if (t.dataset.act === "stop") ctx.setState({ computer: "off" });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  },

  mount(root, ctx) {
    const { mock, icons } = ctx;
    root.innerHTML = `
      <div class="o4-topbar-wrap">${mock.topBar()}</div>
      ${mock.sectionTabs()}
      <div class="m-body">
        <div class="o4-main">
          <button type="button" class="o4-convtoggle m-btn-quiet" data-act="toggle-conv" data-focus="act-conv-toggle" aria-pressed="false" hidden>Conversations</button>
          ${mock.mainPanel()}
        </div>
        <div class="m-seam" data-seam></div>
        <div class="o4-right" data-right></div>
        <div class="o4-scrim" data-scrim hidden></div>
        <aside class="o4-drawer" data-drawer hidden aria-label="Right panel">
          <div class="o4-drawer-head">
            <span class="m-label-mono">Right panel</span>
            <button type="button" class="o4-drawer-close m-btn-quiet" data-act="drawer-close" data-focus="act-drawer-close" aria-label="Close right panel">${icons.x}</button>
          </div>
          <div class="o4-drawer-body" data-drawer-body></div>
        </aside>
      </div>`;

    const topRight = root.querySelector(".o4-topbar-wrap .m-topbar-right");
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "o4-drawer-toggle";
    toggleBtn.dataset.act = "drawer-open";
    toggleBtn.dataset.focus = "act-drawer-open";
    toggleBtn.setAttribute("aria-label", "Show right panel");
    toggleBtn.innerHTML = icons.panelOpen;
    topRight.appendChild(toggleBtn);

    const right = root.querySelector("[data-right]");
    const seam = root.querySelector("[data-seam]");
    const scrim = root.querySelector("[data-scrim]");
    const drawer = root.querySelector("[data-drawer]");
    const drawerBody = root.querySelector("[data-drawer-body]");
    const convToggle = root.querySelector(".o4-convtoggle");
    const conv = root.querySelector(".m-conv");
    const detachSash = ctx.attachSash(seam);
    const unwireRight = this.wirePanel(right, ctx);
    const unwireDrawer = this.wirePanel(drawerBody, ctx);

    const onClick = (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      if (t.dataset.act === "toggle-conv") ctx.setState({ convOpen: !ctx.getState().convOpen });
      if (t.dataset.act === "drawer-open") ctx.setState({ drawerOpen: true });
      if (t.dataset.act === "drawer-close") ctx.setState({ drawerOpen: false });
      if (t.dataset.act === "rail-open") ctx.setState({ tab: t.dataset.tab, rightWidth: 360 });
    };
    root.addEventListener("click", onClick);
    const onScrimClick = () => ctx.setState({ drawerOpen: false });
    scrim.addEventListener("click", onScrimClick);
    const onKey = (e) => {
      if (e.key === "Escape" && ctx.getState().drawerOpen) ctx.setState({ drawerOpen: false });
    };
    document.addEventListener("keydown", onKey);

    let lastRightKey = "";
    let lastDrawerKey = "";

    const update = (state) => {
      const L = this.layout(state);
      const inDrawerMode = L.mode === "drawer";

      seam.hidden = inDrawerMode;
      right.hidden = inDrawerMode;
      toggleBtn.hidden = !inDrawerMode;
      toggleBtn.setAttribute("aria-pressed", String(!!state.drawerOpen));

      if (!inDrawerMode) {
        right.style.width = `${L.width}px`;
        const key = `${L.mode}|${state.tab}|${state.computer}`;
        if (key !== lastRightKey) {
          WS.renderKeepFocus(
            right,
            L.mode === "rail" ? this.renderRail(state, ctx) : this.renderPanel(state, ctx),
          );
          lastRightKey = key;
        }
      }

      drawer.hidden = !inDrawerMode;
      scrim.hidden = !inDrawerMode;
      if (inDrawerMode) {
        const showDrawer = !!state.drawerOpen;
        drawer.classList.toggle("is-open", showDrawer);
        scrim.classList.toggle("is-open", showDrawer);
        drawer.setAttribute("aria-hidden", String(!showDrawer));
        const dKey = `${state.tab}|${state.computer}`;
        if (dKey !== lastDrawerKey) {
          WS.renderKeepFocus(drawerBody, this.renderPanel(state, ctx));
          lastDrawerKey = dKey;
        }
      }

      const convVisible = L.mainW >= 720 ? true : !!state.convOpen;
      convToggle.hidden = L.mainW >= 720;
      convToggle.setAttribute("aria-pressed", String(!!state.convOpen));
      if (conv) conv.hidden = !convVisible;

      ctx.report(
        inDrawerMode
          ? "Window < 1024px: drawer"
          : L.mode === "rail"
            ? "Right panel collapsed to rail"
            : `Right panel ${L.width}px · main ${L.mainW}px`,
      );
    };
    update(ctx.getState());
    return {
      update,
      destroy() {
        detachSash();
        unwireRight();
        unwireDrawer();
        root.removeEventListener("click", onClick);
        scrim.removeEventListener("click", onScrimClick);
        document.removeEventListener("keydown", onKey);
      },
    };
  },

  mountPanel(root, ctx) {
    const unwire = this.wirePanel(root, ctx);
    const update = (state) => {
      WS.renderKeepFocus(root, this.renderPanel(state, ctx));
    };
    update(ctx.getState());
    return { update, destroy: unwire };
  },
});
