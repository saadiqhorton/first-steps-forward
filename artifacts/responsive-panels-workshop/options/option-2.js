/* Option 2: Icon rail — a 44px vertical icon rail (VS Code activity-bar style)
 * replaces the horizontal tab strip. The rail is always present: it's how you
 * get back to a collapsed panel, and below 1024px it's how you open the panel
 * as a floating overlay. See README.md in this folder for the option contract. */
WS.register({
  id: 2,
  name: "Icon rail",
  tradeoff:
    "The rail is always one click away at every size, but tab labels give way to icons and the panel loses 44px of width.",
  notes: [
    "A 44px icon rail replaces the horizontal tab strip, so no label can ever clip — tabs are icon buttons with tooltips and an amber indicator on the active one.",
    "Dragging the seam below ~200px collapses the content area down to just the rail. Clicking any rail icon reopens the panel at 320px; clicking the already-active icon collapses it again.",
    "The Computer tab swaps between a centered 16:10 card (content ≥360px) and a compact status row + full-width Start button + decorative mini-screen strip (content &lt;360px), via a container query on <code>.m-right</code>.",
    "Below a 1024px window the main panel takes the full width and the rail sits at the right edge; clicking an icon opens the panel as a floating sheet (360px or 90% of the window) with a scrim, closed by Esc or the scrim.",
    "In code: <code>Shell.tsx</code>'s right-panel tab strip becomes a rail component, <code>AgentComputerPane.tsx</code> gets the <code>@container</code>-driven compact layout, and a small-window overlay/scrim wraps the panel below 1024px.",
  ],

  RAIL_W: 44,
  COLLAPSE_BELOW: 200,
  REOPEN_WIDTH: 320,
  MOBILE_VP: 1024,

  css: `
    .opt-2 .o2-side { display: flex; flex: none; min-height: 0; }
    .opt-2 .o2-contentwrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; flex: none; }
    .opt-2 .o2-rail { display: flex; flex-direction: column; width: 44px; flex: none; border-left: 1px solid var(--line); background: var(--panel); }
    .opt-2 .o2-rail-btn { position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: none; color: var(--dim); }
    .opt-2 .o2-rail-btn:hover { color: var(--ink); background: color-mix(in oklab, var(--ink) 6%, transparent); }
    .opt-2 .o2-rail-btn[aria-selected="true"] { color: var(--ink); }
    .opt-2 .o2-rail-btn[aria-selected="true"]::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px; border-radius: 2px; background: var(--amber); }
    .opt-2 .o2-scrim { position: absolute; inset: 0; right: 44px; background: var(--scrim); border: 0; z-index: 5; }
    .opt-2 .o2-sheet { position: absolute; top: 0; bottom: 0; right: 44px; display: flex; flex-direction: column; min-width: 0; min-height: 0; box-shadow: var(--shadow-floating); background: var(--panel); border-left: 1px solid var(--line); border-radius: var(--radius-panel) 0 0 var(--radius-panel); overflow: hidden; z-index: 6; }
    .opt-2 .o2-sheet-inner { display: flex; flex-direction: column; min-height: 0; flex: 1; }

    .opt-2 .o2-head { display: flex; align-items: center; gap: 8px; height: 36px; flex: none; padding: 0 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-2 .o2-head-label { flex: none; font-size: 13px; font-weight: 500; }
    .opt-2 .o2-head-proj { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
    .opt-2 .o2-head-right { flex: none; }

    .opt-2 .o2-computer { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .opt-2 .o2-narrow { display: none; }
    @container right (max-width: 359px) {
      .opt-2 .o2-wide { display: none; }
      .opt-2 .o2-narrow { display: block; }
    }
    .opt-2 .o2-card { display: flex; flex-direction: column; width: 100%; border-radius: 12px; border: 1px solid var(--line); overflow: hidden; background: #141716; color: #fff; }
    .opt-2 .o2-card-inner { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; aspect-ratio: 16 / 10; padding: 20px; text-align: center; }
    .opt-2 .o2-card-inner::before { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(218, 174, 92, .10), transparent 58%); pointer-events: none; }
    .opt-2 .o2-card-body { position: relative; max-width: 24rem; }
    .opt-2 .o2-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, .1); background: rgba(255, 255, 255, .04); color: var(--amber); }
    .opt-2 .o2-icon svg { width: 24px; height: 24px; stroke-width: 1.5; }
    .opt-2 .o2-eyebrow { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: rgba(255, 255, 255, .45); }
    .opt-2 .o2-card h2 { margin: 8px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
    .opt-2 .o2-card p { margin: 8px auto 0; max-width: 20rem; font-size: 12px; line-height: 1.6; color: rgba(255, 255, 255, .65); }
    .opt-2 .o2-start { display: inline-flex; align-items: center; gap: 8px; margin-top: 20px; padding: 8px 16px; font-size: 12px; }
    .opt-2 .o2-foot { display: flex; flex: none; justify-content: space-between; padding: 8px 16px; border-top: 1px solid rgba(255, 255, 255, .1); font-family: var(--font-mono); font-size: 10px; color: rgba(255, 255, 255, .45); }

    .opt-2 .o2-compact { display: flex; flex-direction: column; gap: 10px; }
    .opt-2 .o2-compact-row { display: flex; align-items: center; gap: 8px; }
    .opt-2 .o2-compact-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; background: var(--surface-muted); color: var(--amber); }
    .opt-2 .o2-compact-icon svg { width: 16px; height: 16px; }
    .opt-2 .o2-compact-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; }
    .opt-2 .o2-compact-desc { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dim); }
    .opt-2 .o2-compact-start { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 8px 12px; font-size: 12px; }
    .opt-2 .o2-mini { width: 100%; flex: none; aspect-ratio: 16 / 10; border-radius: 8px; background: #141716; }

    .opt-2 .o2-hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-2 .o2-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .opt-2 .o2-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-2 .o2-details { margin-top: 4px; border-top: 1px solid var(--line); }
    .opt-2 .o2-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-2 .o2-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
  `,

  /** The rendered content width (desktop/full mode only): 240 min, 60% of window max, main kept at 40% min. */
  contentWidth(state) {
    const vp = state.viewport;
    if (vp < this.MOBILE_VP) return 0;
    if (state.rightWidth < this.COLLAPSE_BELOW) return 0;
    const maxByPanel = vp * 0.6;
    const maxByMain = vp - this.RAIL_W - vp * 0.4;
    const max = Math.min(maxByPanel, maxByMain);
    return Math.round(Math.max(240, Math.min(max, Math.max(240, state.rightWidth))));
  },

  sheetWidth(state) {
    return Math.round(Math.min(360, state.viewport * 0.9));
  },

  renderRail(state, { mock }) {
    return `<nav class="o2-rail" role="tablist" aria-label="Right panel tabs">
      ${mock.rightTabs
        .map(
          (t) =>
            `<button type="button" role="tab" class="o2-rail-btn" data-rail="${t.id}" data-focus="rail-${t.id}" title="${t.label}" aria-label="${t.label}" aria-selected="${state.tab === t.id}">${t.icon}</button>`,
        )
        .join("")}
    </nav>`;
  },

  renderContent(state, ctx) {
    const { mock } = ctx;
    const t = mock.rightTabs.find((x) => x.id === state.tab);
    const isComputer = state.tab === "computer";
    let body;
    if (state.tab === "activity") body = `<div class="m-scroll">${mock.activityBody()}</div>`;
    else if (state.tab === "diff") body = `<div class="m-scroll">${mock.diffBody()}</div>`;
    else if (state.tab === "terminal") body = mock.terminalBody();
    else body = this.renderComputer(state, ctx);
    return `<div class="m-right o2-content">
      <div class="o2-head">
        <span class="o2-head-label">${t ? t.label : ""}</span>
        ${isComputer ? `<span class="o2-head-proj m-truncate">${mock.project}</span><span class="o2-head-right">${mock.statusPill(state.computer)}</span>` : ""}
      </div>
      ${body}
    </div>`;
  },

  renderComputer(state, { mock, icons }) {
    const c = mock.computerCopy[state.computer];
    const isLive = state.computer === "live";
    const monitorIcon =
      state.computer === "starting"
        ? icons.loader.replace('class="i"', 'class="i m-spin"')
        : icons.monitor;
    const screen = isLive
      ? `<div class="m-screen">${mock.liveScreen()}</div>`
      : `<div class="o2-wide"><div class="o2-card">
          <div class="o2-card-inner"><div class="o2-card-body">
            <div class="o2-icon">${monitorIcon}</div>
            <div class="o2-eyebrow">${mock.project} · local desktop</div>
            <h2>${c.title}</h2>
            <p>${c.description}</p>
            ${c.action ? `<button type="button" class="o2-start m-btn-amber" data-act="start" data-focus="start">${icons.monitor}${c.action}</button>` : ""}
          </div></div>
          <div class="o2-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
        </div></div>
        <div class="o2-narrow"><div class="o2-compact">
          <div class="o2-compact-row">
            <span class="o2-compact-icon">${monitorIcon}</span>
            <span class="o2-compact-title m-truncate">${c.title}</span>
            ${mock.statusPill(state.computer)}
          </div>
          <p class="o2-compact-desc">${c.description}</p>
          ${c.action ? `<button type="button" class="o2-compact-start m-btn-amber" data-act="start" data-focus="start">${icons.monitor}${c.action}</button>` : ""}
          <div class="o2-mini" aria-hidden="true"></div>
        </div></div>`;
    return `<div class="m-scroll o2-computer">
      ${screen}
      <p class="o2-hint">${c.hint}</p>
      ${
        isLive
          ? `<div class="o2-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop" data-focus="stop">Turn off</button></div>`
          : ""
      }
      <div class="o2-details">
        <div class="o2-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
        ${mock.detailsRows()}
      </div>
    </div>`;
  },

  /** Click/keyboard wiring shared by mount and mountPanel (mock outcomes only). */
  wire(root, ctx) {
    const onClick = (e) => {
      const t = e.target.closest("[data-rail],[data-act],[data-scrim]");
      if (!t) return;
      if (t.dataset.scrim !== undefined) {
        ctx.setState({ sheetOpen: false });
        return;
      }
      if (t.dataset.act === "start") {
        ctx.setState({ computer: "starting" });
        return;
      }
      if (t.dataset.act === "stop") {
        ctx.setState({ computer: "off" });
        return;
      }
      if (t.dataset.rail) {
        const id = t.dataset.rail;
        const state = ctx.getState();
        if (ctx.kind === "panel") {
          ctx.setState({ tab: id });
        } else if (state.viewport < this.MOBILE_VP) {
          if (state.sheetOpen && state.tab === id) ctx.setState({ sheetOpen: false });
          else ctx.setState({ tab: id, sheetOpen: true });
        } else if (state.rightWidth < this.COLLAPSE_BELOW) {
          ctx.setState({ tab: id, rightWidth: this.REOPEN_WIDTH });
        } else if (state.tab === id) {
          ctx.setState({ rightWidth: 0 });
        } else {
          ctx.setState({ tab: id });
        }
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape" && ctx.getState().sheetOpen) ctx.setState({ sheetOpen: false });
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
    };
  },

  mount(root, ctx) {
    const { mock } = ctx;
    root.innerHTML = `${mock.topBar()}${mock.sectionTabs()}
      <div class="m-body">
        <div class="o2-main" style="display:flex;flex:1;min-width:0">${mock.mainPanel()}</div>
        <div class="m-seam" data-seam></div>
        <div class="o2-side" data-side>
          <div class="o2-contentwrap" data-contentwrap></div>
          <div class="o2-rail" data-rail-el></div>
        </div>
        <button type="button" class="o2-scrim" data-scrim hidden aria-label="Close panel"></button>
        <div class="o2-sheet" data-sheet hidden><div class="o2-sheet-inner" data-sheetbody></div></div>
      </div>`;
    const contentwrap = root.querySelector("[data-contentwrap]");
    const railEl = root.querySelector("[data-rail-el]");
    const seam = root.querySelector("[data-seam]");
    const scrim = root.querySelector("[data-scrim]");
    const sheet = root.querySelector("[data-sheet]");
    const sheetbody = root.querySelector("[data-sheetbody]");
    const conv = root.querySelector(".m-conv");
    const detachSash = ctx.attachSash(seam);
    const unwire = this.wire(root, ctx);
    let lastKey = "";

    const update = (state) => {
      const vp = state.viewport;
      const mobile = vp < this.MOBILE_VP;
      seam.hidden = mobile;
      WS.renderKeepFocus(railEl, this.renderRail(state, ctx));

      let contentW = 0;
      let mainW = vp - this.RAIL_W;
      if (mobile) {
        contentwrap.style.width = "0px";
        scrim.hidden = !state.sheetOpen;
        sheet.hidden = !state.sheetOpen;
        if (state.sheetOpen) sheet.style.width = `${this.sheetWidth(state)}px`;
      } else {
        scrim.hidden = true;
        sheet.hidden = true;
        contentW = this.contentWidth(state);
        contentwrap.style.width = `${contentW}px`;
        mainW = vp - this.RAIL_W - contentW - (contentW ? 4 : 0);
      }

      const key = `${state.tab}|${state.computer}|${mobile}|${state.sheetOpen}|${contentW > 0}`;
      if (key !== lastKey) {
        if (mobile) {
          contentwrap.innerHTML = "";
          if (state.sheetOpen) WS.renderKeepFocus(sheetbody, this.renderContent(state, ctx));
          else sheetbody.innerHTML = "";
        } else {
          sheetbody.innerHTML = "";
          if (contentW > 0) WS.renderKeepFocus(contentwrap, this.renderContent(state, ctx));
          else contentwrap.innerHTML = "";
        }
        lastKey = key;
      }

      if (conv) conv.style.width = `${Math.max(240, mainW * 0.24)}px`;

      ctx.report(
        mobile
          ? state.sheetOpen
            ? `Window < 1024px: sheet open at ${this.sheetWidth(state)}px over main`
            : "Window < 1024px: panel collapsed to the 44px rail"
          : contentW === 0
            ? "Right panel collapsed to the 44px rail"
            : `Right panel ${contentW + this.RAIL_W}px (rail 44 + content ${contentW}) · main ${Math.round(mainW)}px`,
      );
    };
    update(ctx.getState());
    return {
      update,
      destroy() {
        detachSash();
        unwire();
      },
    };
  },

  mountPanel(root, ctx) {
    root.innerHTML = `<div class="o2-side" data-side style="height:100%">
      <div class="o2-contentwrap" data-contentwrap style="flex:1"></div>
      <div class="o2-rail" data-rail-el></div>
    </div>`;
    const contentwrap = root.querySelector("[data-contentwrap]");
    const railEl = root.querySelector("[data-rail-el]");
    const unwire = this.wire(root, ctx);
    let lastKey = "";
    const update = (state) => {
      WS.renderKeepFocus(railEl, this.renderRail(state, ctx));
      const key = `${state.tab}|${state.computer}`;
      if (key !== lastKey) {
        WS.renderKeepFocus(contentwrap, this.renderContent(state, ctx));
        lastKey = key;
      }
    };
    update(ctx.getState());
    return { update, destroy: unwire };
  },
});
