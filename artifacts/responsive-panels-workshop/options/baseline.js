/* Today: reproduces the current shipped behaviour (Shell.tsx + AgentComputerPane.tsx)
 * so the options have a baseline. Also the reference implementation of the option
 * contract — see README.md in this folder. */
WS.register({
  id: 0,
  name: "Today",
  tradeoff:
    "The current shell. The right panel can be dragged down to 240px, but its contents were designed for about 400px, so tabs clip and the Computer card hides its Start button.",
  notes: [
    "The right panel has a 240px minimum and a 60% maximum, and the main panel has a 40% minimum. All of these come from <code>Shell.tsx</code>.",
    "The tab strip has no overflow handling, so <b>Terminal</b> is clipped first.",
    "The Computer card is a fixed 16:10 box with <code>overflow-hidden</code> and a footer pinned to the bottom. When the panel is narrow, the title runs into the footer and the Start button is clipped.",
    "Workflow cards switch columns by <b>window</b> width, so a narrow main panel still gets three thin columns.",
    "Below a 1024px window, the right panel is not rendered at all.",
  ],
  css: `
    .opt-0 .t0-tabs { display: flex; height: 36px; flex: none; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-0 .t0-tab { position: relative; padding: 0 12px; font-size: 14px; color: var(--dim); white-space: nowrap; }
    .opt-0 .t0-tab[aria-selected="true"] { color: var(--ink); }
    .opt-0 .t0-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--amber); }
    .opt-0 .t0-term { margin-left: auto; display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 14px; color: var(--dim); white-space: nowrap; }
    .opt-0 .t0-head { display: flex; height: 44px; flex: none; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--line); }
    .opt-0 .t0-head b { display: block; font-size: 14px; font-weight: 500; }
    .opt-0 .t0-head small { display: block; font-size: 11px; color: var(--dim); }
    .opt-0 .t0-card { position: relative; display: grid; place-items: center; aspect-ratio: 16/10; width: 100%; overflow: hidden; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; padding: 0 20px; text-align: center; }
    .opt-0 .t0-card::before { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(218,174,92,.10), transparent 58%); }
    .opt-0 .t0-card-inner { position: relative; max-width: 24rem; }
    .opt-0 .t0-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: var(--amber); }
    .opt-0 .t0-icon svg { width: 24px; height: 24px; stroke-width: 1.5; }
    .opt-0 .t0-eyebrow { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: rgba(255,255,255,.45); }
    .opt-0 .t0-card h2 { margin: 8px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
    .opt-0 .t0-card p { margin: 8px auto 0; max-width: 20rem; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,.65); }
    .opt-0 .t0-start { display: inline-flex; align-items: center; gap: 8px; margin-top: 20px; padding: 8px 16px; font-size: 12px; }
    .opt-0 .t0-foot { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; padding: 8px 16px; border-top: 1px solid rgba(255,255,255,.1); font-family: var(--font-mono); font-size: 10px; color: rgba(255,255,255,.45); }
    .opt-0 .t0-hint { margin: 4px 16px 16px; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-0 .t0-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px 16px; }
    .opt-0 .t0-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-0 .t0-details { margin-top: auto; border-top: 1px solid var(--line); }
    .opt-0 .t0-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-0 .t0-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
    /* Today the main panel pads by a fixed 28px and picks columns by window width. */
    .opt-0 .m-task-inner { padding: 40px 28px !important; }
    .opt-0 .m-task h1 { font-size: 30px !important; }
    .opt-0[data-vp-cols="2"] .m-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .opt-0[data-vp-cols="3"] .m-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .opt-0[data-vp-cols="1"] .m-cards { grid-template-columns: minmax(0, 1fr); }
    .opt-0 .m-composer-foot { flex-wrap: nowrap; }
    .opt-0 .m-wcard-title > span { min-width: auto; }
  `,

  /** Today's right panel. Shared by the full mount and the close-ups. */
  renderPanel(state, { mock, icons }) {
    const tab = (id, label) =>
      `<button type="button" role="tab" class="t0-tab" data-tab="${id}" data-focus="tab-${id}" aria-selected="${state.tab === id}">${label}</button>`;
    let body;
    if (state.tab === "activity") body = `<div class="m-scroll">${mock.activityBody()}</div>`;
    else if (state.tab === "diff") body = `<div class="m-scroll">${mock.diffBody()}</div>`;
    else if (state.tab === "terminal") body = mock.terminalBody();
    else body = this.renderComputer(state, { mock, icons });
    return `<div class="m-right">
      <div class="t0-tabs" role="tablist" aria-label="Right panel (mock)">
        ${tab("activity", "Activity")}${tab("diff", "Diff")}${tab("computer", "Computer")}
        <button type="button" class="t0-term" data-tab="terminal" data-focus="tab-terminal"><span aria-hidden="true">›_</span> Terminal</button>
      </div>
      ${body}
    </div>`;
  },

  renderComputer(state, { mock, icons }) {
    const c = mock.computerCopy[state.computer];
    const screen =
      state.computer === "live"
        ? `<div class="m-screen">${mock.liveScreen()}</div>`
        : `<div class="t0-card">
            <div class="t0-card-inner">
              <div class="t0-icon">${state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor}</div>
              <div class="t0-eyebrow">${mock.project} · local desktop</div>
              <h2>${c.title}</h2>
              <p>${c.description}</p>
              ${c.action ? `<button type="button" class="t0-start m-btn-amber" data-act="start">${icons.monitor}${c.action}</button>` : ""}
            </div>
            <div class="t0-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
          </div>`;
    return `<div class="m-scroll" style="display:flex;flex-direction:column">
      <div class="t0-head"><div style="min-width:0"><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>
      <div style="padding-bottom:12px">${screen}</div>
      <p class="t0-hint">${c.hint}</p>
      ${
        state.computer === "live"
          ? `<div class="t0-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop">Turn off</button></div>`
          : ""
      }
      <div class="t0-details">
        <div class="t0-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
        ${mock.detailsRows()}
      </div>
    </div>`;
  },

  /** Simulated outcomes for buttons inside the panel (mock only). */
  wirePanel(el, ctx) {
    const onClick = (e) => {
      const t = e.target.closest("[data-tab],[data-act]");
      if (!t) return;
      if (t.dataset.tab) ctx.setState({ tab: t.dataset.tab });
      if (t.dataset.act === "start") ctx.setState({ computer: "starting" });
      if (t.dataset.act === "stop") ctx.setState({ computer: "off" });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  },

  /** Today's sizing rules from Shell.tsx. Returns the rendered right width in px. */
  layout(state) {
    if (state.viewport < 1024) return 0;
    const max = state.viewport * 0.6; // shell-right maxSize 60% (main minSize 40%)
    let w = state.rightWidth;
    if (w < 120) return 0; // the library collapses the panel when dragged well past its minimum
    return Math.round(Math.min(max, Math.max(240, w)));
  },

  mount(root, ctx) {
    const { mock } = ctx;
    root.innerHTML = `${mock.topBar()}${mock.sectionTabs()}
      <div class="m-body">
        <div class="t0-main" style="display:flex;flex:1;min-width:0">${mock.mainPanel()}</div>
        <div class="m-seam" data-seam></div>
        <div class="t0-right" style="flex:none;min-width:0;overflow:hidden"></div>
      </div>`;
    const right = root.querySelector(".t0-right");
    const seam = root.querySelector("[data-seam]");
    const conv = root.querySelector(".m-conv");
    const detachSash = ctx.attachSash(seam);
    const unwire = this.wirePanel(right, ctx);
    let lastKey = "";

    const update = (state) => {
      const w = this.layout(state);
      const vp = state.viewport;
      root.dataset.vpCols = vp >= 780 ? "3" : vp >= 520 ? "2" : "1";
      seam.hidden = vp < 1024;
      right.hidden = w === 0;
      right.style.width = `${w}px`;
      const mainW = vp - (w ? w + 4 : 0);
      // conversations-list: 24% of the main panel, min 240px
      conv.style.width = `${Math.max(240, mainW * 0.24)}px`;
      const key = `${state.tab}|${state.computer}`;
      if (key !== lastKey) {
        WS.renderKeepFocus(right, this.renderPanel(state, ctx));
        lastKey = key;
      }
      ctx.report(
        vp < 1024
          ? "Window < 1024px: right panel not rendered"
          : w === 0
            ? "Right panel collapsed"
            : `Right panel ${w}px · main ${mainW}px`,
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
    const unwire = this.wirePanel(root, ctx);
    const update = (state) => {
      WS.renderKeepFocus(root, this.renderPanel(state, ctx));
    };
    update(ctx.getState());
    return { update, destroy: unwire };
  },
});
