/* Option 5: Bottom dock. When the window, the request, or the minimums say the
 * right panel can't be usable beside the main panel, it docks below instead of
 * shrinking past readable. See README.md for the option contract. */
WS.register({
  id: 5,
  name: "Bottom dock",
  tradeoff:
    "It uses space well on narrow and short layouts, but the panel moves around, which can disorient people mid-task.",
  notes: [
    "Side mode keeps a 320px minimum for the right panel and a 520px minimum for the main panel; below that combination the layout docks instead of shrinking either one past where it's usable.",
    "Auto mode docks below a 1024px window, when the requested right width drops under 240px, or whenever both minimums can't fit side by side. A header toggle lets you pin <b>Dock to side</b> or <b>Dock to bottom</b> when the window is wide enough to actually support both.",
    "Docked, the tabs move to the left of a header row with the dock toggle and a collapse chevron that shrinks the dock to a 36px bar. The Computer tab lays its screen beside its details until the dock narrows past about 560px, then it stacks and scrolls.",
    "In code: Shell.tsx would switch the Group's orientation (or render a vertical Group below the threshold) and persist the dock preference; AgentComputerPane would gain a horizontal layout driven by a @container query instead of its fixed aspect-ratio card.",
    "The off/error/starting Computer card keeps its 16:10 aspect ratio only as a minimum height, with its footer back in normal flow, so the Start button can never be clipped.",
  ],
  css: `
    .opt-5 .o5-main { display: flex; flex: 1; min-width: 520px; min-height: 0; overflow: hidden; }
    .opt-5 .m-body[data-dock="true"] { flex-direction: column; }
    .opt-5 .o5-right { flex: none; min-width: 0; overflow: hidden; }
    .opt-5 .o5-hseam { flex: none; width: 100%; height: 4px; background: var(--line); }
    .opt-5 .o5-dock { flex: none; width: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--panel); container-type: inline-size; container-name: o5dock; }

    /* Panel header: tabs on the left, dock toggle + collapse chevron on the right */
    .opt-5 .o5-head { display: flex; align-items: center; height: 36px; flex: none; gap: 6px; padding-right: 6px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-5 .o5-tabs { display: flex; align-items: center; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
    .opt-5 .o5-tabs::-webkit-scrollbar { height: 4px; }
    .opt-5 .o5-tab { position: relative; display: inline-flex; flex: none; align-items: center; gap: 6px; height: 36px; padding: 0 10px; font-size: 13px; color: var(--dim); white-space: nowrap; }
    .opt-5 .o5-tab svg { width: 14px; height: 14px; }
    .opt-5 .o5-tab[aria-selected="true"] { color: var(--ink); }
    .opt-5 .o5-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; border-radius: 2px; background: var(--amber); }
    .opt-5 .o5-head-actions { display: flex; flex: none; align-items: center; gap: 6px; }
    .opt-5 .o5-dock-toggle { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 5px 10px; font-size: 11px; white-space: nowrap; }
    .opt-5 .o5-collapse { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; color: var(--dim); }
    .opt-5 .o5-collapse:hover { background: var(--surface-muted); }
    .opt-5 .o5-collapse svg { transition: transform 0.15s ease; }
    .opt-5 .o5-collapse[aria-expanded="false"] svg { transform: rotate(180deg); }

    /* Computer tab, side mode: card keeps its aspect ratio as a minimum only, footer in flow */
    .opt-5 .o5-chead { display: flex; height: 44px; flex: none; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--line); }
    .opt-5 .o5-chead b { display: block; font-size: 14px; font-weight: 500; }
    .opt-5 .o5-chead small { display: block; font-size: 11px; color: var(--dim); }
    .opt-5 .o5-card { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; aspect-ratio: 16 / 10; margin: 12px; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; padding: 20px; text-align: center; }
    .opt-5 .o5-card::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(ellipse at center, rgba(218, 174, 92, 0.1), transparent 58%); }
    .opt-5 .o5-card-inner { position: relative; max-width: 24rem; }
    .opt-5 .o5-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.04); color: var(--amber); }
    .opt-5 .o5-icon svg { width: 24px; height: 24px; stroke-width: 1.5; }
    .opt-5 .o5-eyebrow { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: rgba(255, 255, 255, 0.45); }
    .opt-5 .o5-card h2 { margin: 8px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
    .opt-5 .o5-card p { margin: 8px auto 0; max-width: 20rem; font-size: 12px; line-height: 1.6; color: rgba(255, 255, 255, 0.65); }
    .opt-5 .o5-start { display: inline-flex; align-items: center; gap: 8px; margin-top: 20px; padding: 8px 16px; font-size: 12px; }
    .opt-5 .o5-foot { position: relative; margin-top: 16px; width: 100%; max-width: 24rem; display: flex; justify-content: space-between; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-family: var(--font-mono); font-size: 10px; color: rgba(255, 255, 255, 0.45); }
    .opt-5 .o5-live-wrap { margin: 12px; width: calc(100% - 24px); border-radius: 12px; overflow: hidden; }
    .opt-5 .o5-hint { margin: 4px 16px 16px; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-5 .o5-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px 16px; }
    .opt-5 .o5-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-5 .o5-details { margin-top: auto; border-top: 1px solid var(--line); }
    .opt-5 .o5-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-5 .o5-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }

    /* Computer tab, dock mode: screen/card at a fixed height on the left, info column on the right */
    .opt-5 .o5-dc { display: flex; flex-direction: row; gap: 12px; padding: 12px; flex: 1; min-height: 0; overflow: hidden; }
    .opt-5 .o5-dc-media { flex: none; height: 180px; }
    .opt-5 .o5-dc-media > * { height: 100%; width: auto; aspect-ratio: 16 / 10; border-radius: 12px; }
    .opt-5 .o5-dc-media .m-screen { overflow: hidden; }
    .opt-5 .o5-dc-card { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--line); background: #141716; color: #fff; padding: 10px; text-align: center; overflow: auto; }
    .opt-5 .o5-dc-icon { display: grid; place-items: center; width: 32px; height: 32px; margin: 0 auto 6px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.04); color: var(--amber); }
    .opt-5 .o5-dc-icon svg { width: 16px; height: 16px; stroke-width: 1.5; }
    .opt-5 .o5-dc-eyebrow { font-family: var(--font-mono); font-size: 8px; text-transform: uppercase; letter-spacing: 0.14em; color: rgba(255, 255, 255, 0.45); }
    .opt-5 .o5-dc-card h2 { margin: 4px 0 0; font-size: 12px; font-weight: 500; letter-spacing: -0.01em; }
    .opt-5 .o5-dc-card p { margin: 4px auto 0; font-size: 10px; line-height: 1.4; color: rgba(255, 255, 255, 0.65); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .opt-5 .o5-dc-start { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 5px 10px; font-size: 10px; }
    .opt-5 .o5-dc-foot { margin-top: 8px; width: 100%; display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-family: var(--font-mono); font-size: 8px; color: rgba(255, 255, 255, 0.45); }
    /* The docked card is short: keep the title and the Start button, and let the info column carry the description. */
    .opt-5 .o5-dc-eyebrow, .opt-5 .o5-dc-card p { display: none; }
    .opt-5 .o5-dc-card h2 { font-size: 13px; }
    .opt-5 .o5-dc-start { margin-top: 12px; padding: 7px 14px; font-size: 12px; }
    .opt-5 .o5-dc-foot { margin-top: auto; font-size: 9px; }
    .opt-5 .o5-dc-card > :first-child { margin-top: auto; }
    .opt-5 .o5-dc-info { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .opt-5 .o5-dc-headrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .opt-5 .o5-dc-headrow b { display: block; font-size: 14px; font-weight: 500; }
    .opt-5 .o5-dc-headrow small { display: block; font-size: 11px; color: var(--dim); }
    .opt-5 .o5-dc-hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-5 .o5-dc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .opt-5 .o5-dc-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-5 .o5-dc-details { margin-top: auto; border-top: 1px solid var(--line); }
    .opt-5 .o5-dc-details-head { display: flex; padding: 8px 10px; border-bottom: 1px solid var(--line); }
    .opt-5 .o5-dc-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
    @container o5dock (max-width: 560px) {
      .opt-5 .o5-dc { flex-direction: column; overflow-y: auto; }
      .opt-5 .o5-dc-media { height: auto; width: 100%; }
      .opt-5 .o5-dc-media > * { height: auto; width: 100%; }
      .opt-5 .o5-dc-info { overflow: visible; }
    }
  `,

  /* ---- sizing rules ---- */
  // Body height inside the full mount is fixed by the workshop frame: 680 - topbar(48) - sections(36).
  BODY_H: 680 - 48 - 36,
  RIGHT_MIN: 320,
  MAIN_MIN: 520,
  SEAM: 4,

  layout(state) {
    const vp = state.viewport;
    const fitsSide = vp >= this.RIGHT_MIN + this.MAIN_MIN + this.SEAM;
    const forced = vp < 1024 || !fitsSide;
    let dock;
    if (forced) dock = true;
    else if (state.dock === "bottom") dock = true;
    else if (state.dock === "side") dock = false;
    else dock = state.rightWidth < 240; // auto
    let rightW = 0;
    if (!dock) {
      const max = Math.min(vp * 0.6, vp - this.MAIN_MIN - this.SEAM);
      rightW = Math.round(Math.min(max, Math.max(this.RIGHT_MIN, state.rightWidth)));
    }
    const dockH = Math.min(280, this.BODY_H * 0.4);
    return { dock, forced, rightW, dockH };
  },

  /* ---- shared panel markup ---- */
  renderHead(state, ctx, mode, { allowToggle = true } = {}) {
    const { mock, icons } = ctx;
    const L = this.layout(state);
    const tab = (t) =>
      `<button type="button" role="tab" class="o5-tab" data-tab="${t.id}" data-focus="tab-${t.id}" aria-selected="${state.tab === t.id}">${t.icon}<span>${t.label}</span></button>`;
    const toggle =
      allowToggle && !L.forced
        ? `<button type="button" class="o5-dock-toggle m-btn-quiet" data-act="toggle-dock" data-focus="toggle-dock">${
            mode === "dock" ? icons.panelOpen : icons.panelClose
          }${mode === "dock" ? "Dock to side" : "Dock to bottom"}</button>`
        : "";
    const collapse =
      mode === "dock"
        ? `<button type="button" class="o5-collapse" data-act="collapse" data-focus="collapse" aria-label="${state.dockCollapsed ? "Expand dock" : "Collapse dock"}" aria-expanded="${!state.dockCollapsed}">${icons.chevronDown}</button>`
        : "";
    return `<div class="o5-head" role="tablist" aria-label="Right panel (mock)">
      <div class="o5-tabs">${mock.rightTabs.map(tab).join("")}</div>
      <div class="o5-head-actions">${toggle}${collapse}</div>
    </div>`;
  },

  renderBody(state, ctx, mode) {
    if (state.tab === "activity") return `<div class="m-scroll">${ctx.mock.activityBody()}</div>`;
    if (state.tab === "diff") return `<div class="m-scroll">${ctx.mock.diffBody()}</div>`;
    if (state.tab === "terminal") return ctx.mock.terminalBody();
    return mode === "dock"
      ? this.renderComputerDock(state, ctx)
      : this.renderComputerSide(state, ctx);
  },

  renderComputerSide(state, ctx) {
    const { mock, icons } = ctx;
    const c = mock.computerCopy[state.computer];
    const screen =
      state.computer === "live"
        ? `<div class="o5-live-wrap"><div class="m-screen">${mock.liveScreen()}</div></div>`
        : `<div class="o5-card">
            <div class="o5-card-inner">
              <div class="o5-icon">${state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor}</div>
              <div class="o5-eyebrow">${mock.project} · local desktop</div>
              <h2>${c.title}</h2>
              <p>${c.description}</p>
              ${c.action ? `<button type="button" class="o5-start m-btn-amber" data-act="start">${icons.monitor}${c.action}</button>` : ""}
            </div>
            <div class="o5-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
          </div>`;
    return `<div class="m-scroll" style="display:flex;flex-direction:column">
      <div class="o5-chead"><div style="min-width:0"><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>
      ${screen}
      <p class="o5-hint">${c.hint}</p>
      ${
        state.computer === "live"
          ? `<div class="o5-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop">Turn off</button></div>`
          : ""
      }
      <div class="o5-details">
        <div class="o5-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
        ${mock.detailsRows()}
      </div>
    </div>`;
  },

  renderComputerDock(state, ctx) {
    const { mock, icons } = ctx;
    const c = mock.computerCopy[state.computer];
    const screen =
      state.computer === "live"
        ? `<div class="m-screen">${mock.liveScreen()}</div>`
        : `<div class="o5-dc-card">
            <div class="o5-dc-icon">${state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor}</div>
            <div class="o5-dc-eyebrow">${mock.project}</div>
            <h2>${c.title}</h2>
            <p>${c.description}</p>
            ${c.action ? `<button type="button" class="o5-dc-start m-btn-amber" data-act="start">${icons.monitor}${c.action}</button>` : ""}
            <div class="o5-dc-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
          </div>`;
    return `<div class="o5-dc">
      <div class="o5-dc-media">${screen}</div>
      <div class="o5-dc-info">
        <div class="o5-dc-headrow"><div style="min-width:0"><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>
        <p class="o5-dc-hint">${c.hint}</p>
        ${
          state.computer === "live"
            ? `<div class="o5-dc-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop">Turn off</button></div>`
            : ""
        }
        <div class="o5-dc-details">
          <div class="o5-dc-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
          ${mock.detailsRows()}
        </div>
      </div>
    </div>`;
  },

  renderPanel(state, ctx, mode, opts) {
    const head = this.renderHead(state, ctx, mode, opts);
    const body = mode === "dock" && state.dockCollapsed ? "" : this.renderBody(state, ctx, mode);
    return head + body;
  },

  /** Simulated outcomes for buttons inside either panel (mock only). */
  wirePanel(el, ctx) {
    const onClick = (e) => {
      const t = e.target.closest("[data-tab],[data-act]");
      if (!t) return;
      if (t.dataset.tab) ctx.setState({ tab: t.dataset.tab });
      if (t.dataset.act === "start") ctx.setState({ computer: "starting" });
      if (t.dataset.act === "stop") ctx.setState({ computer: "off" });
      if (t.dataset.act === "toggle-dock") {
        const L = this.layout(ctx.getState());
        ctx.setState({ dock: L.dock ? "side" : "bottom" });
      }
      if (t.dataset.act === "collapse")
        ctx.setState({ dockCollapsed: !ctx.getState().dockCollapsed });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  },

  mount(root, ctx) {
    const { mock } = ctx;
    root.innerHTML = `${mock.topBar()}${mock.sectionTabs()}
      <div class="m-body">
        <div class="o5-main">${mock.mainPanel()}</div>
        <div class="m-seam" data-seam></div>
        <div class="o5-right"><div class="m-right"></div></div>
        <div class="o5-hseam" data-hseam hidden></div>
        <div class="o5-dock" data-dockpanel hidden></div>
      </div>`;
    const body = root.querySelector(".m-body");
    const seam = root.querySelector("[data-seam]");
    const right = root.querySelector(".o5-right");
    const rightInner = root.querySelector(".o5-right .m-right");
    const hseam = root.querySelector("[data-hseam]");
    const dockPanel = root.querySelector("[data-dockpanel]");
    const conv = root.querySelector(".m-conv");

    const detachSash = ctx.attachSash(seam);
    const unwireSide = this.wirePanel(rightInner, ctx);
    const unwireDock = this.wirePanel(dockPanel, ctx);
    let lastSideKey = "";
    let lastDockKey = "";
    let prevDock = null;

    const update = (state) => {
      const L = this.layout(state);
      body.dataset.dock = String(L.dock);
      seam.hidden = L.dock;
      right.hidden = L.dock;
      hseam.hidden = !L.dock;
      dockPanel.hidden = !L.dock;

      const vp = state.viewport;
      const mainW = L.dock ? vp : vp - L.rightW - this.SEAM;
      if (conv) conv.style.width = `${Math.max(240, mainW * 0.24)}px`;

      if (!L.dock) {
        right.style.width = `${L.rightW}px`;
      } else {
        dockPanel.style.height = state.dockCollapsed ? "36px" : `${L.dockH}px`;
      }

      if (prevDock !== L.dock) {
        lastSideKey = "";
        lastDockKey = "";
        prevDock = L.dock;
      }
      const sideKey = `${state.tab}|${state.computer}|${state.dock}|${L.forced}`;
      if (!L.dock && sideKey !== lastSideKey) {
        WS.renderKeepFocus(rightInner, this.renderPanel(state, ctx, "side"));
        lastSideKey = sideKey;
      }
      const dockKey = `${state.tab}|${state.computer}|${state.dock}|${state.dockCollapsed}|${L.forced}`;
      if (L.dock && dockKey !== lastDockKey) {
        WS.renderKeepFocus(dockPanel, this.renderPanel(state, ctx, "dock"));
        lastDockKey = dockKey;
      }

      ctx.report(
        L.dock
          ? `Docked below · ${state.dockCollapsed ? "36px" : `${Math.round(L.dockH)}px`} tall${state.dockCollapsed ? " (collapsed)" : ""}`
          : `Side · right ${L.rightW}px`,
      );
    };
    update(ctx.getState());
    return {
      update,
      destroy() {
        detachSash();
        unwireSide();
        unwireDock();
      },
    };
  },

  mountPanel(root, ctx) {
    const unwire = this.wirePanel(root, ctx);
    const update = (state) => {
      WS.renderKeepFocus(
        root,
        `<div class="m-right">${this.renderPanel(state, ctx, "side", { allowToggle: false })}</div>`,
      );
    };
    update(ctx.getState());
    return { update, destroy: unwire };
  },
});
