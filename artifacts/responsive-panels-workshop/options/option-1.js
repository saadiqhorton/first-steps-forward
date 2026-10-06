/* Option 1: Fluid reflow — same structure as today, but every piece of the
 * right panel reflows continuously off container queries on .m-right instead
 * of breaking at fixed widths. See README.md in this folder for the contract. */
WS.register({
  id: 1,
  name: "Fluid reflow",
  tradeoff:
    "Smallest change from today: everything reflows smoothly, but small windows still lose the right panel.",
  notes: [
    "The tab strip scrolls horizontally with hidden scrollbars and edge fades instead of clipping; under 340px it switches to tighter padding and the Terminal tab collapses to its glyph.",
    "The Computer card drops its fixed aspect ratio and absolute footer — it's a flex column sized by its content, with <code>aspect-ratio</code> used only as a <code>min-height</code> hint, so the title and Start button never collide.",
    "In code: <code>Shell.tsx</code>'s right-pane tab strip would get <code>overflow-x-auto</code> + scrollbar-hiding and a shrinking Terminal label, and <code>AgentComputerPane.tsx</code>'s off/error card would drop <code>overflow-hidden</code> and the absolute footer for a normal-flow <code>@container</code>-driven column.",
    "This option deliberately doesn't solve small windows — below 1024px the panel still isn't rendered, matching today's behaviour, with a note in the report instead of a fix.",
    "Dragging the seam under ~130px still collapses the panel to 0, but a small expand handle stays on the seam so it can be reopened without hunting for the edge.",
  ],
  css: `
    .opt-1 .o1-tabs { position: relative; display: flex; height: 36px; flex: none; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-1 .o1-tabs-scroll { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 0 8px; }
    .opt-1 .o1-tabs-scroll::-webkit-scrollbar { display: none; }
    .opt-1 .o1-tabs::before,
    .opt-1 .o1-tabs::after { content: ""; position: absolute; top: 0; bottom: 0; width: 14px; pointer-events: none; z-index: 1; }
    .opt-1 .o1-tabs::before { left: 0; background: linear-gradient(90deg, var(--panel), transparent); }
    .opt-1 .o1-tabs::after { right: 0; background: linear-gradient(270deg, var(--panel), transparent); }
    .opt-1 .o1-tab { position: relative; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 12px; font-size: 14px; color: var(--dim); white-space: nowrap; }
    .opt-1 .o1-tab[aria-selected="true"] { color: var(--ink); }
    .opt-1 .o1-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--amber); }
    .opt-1 .o1-tab .o1-tab-full { display: inline; }
    .opt-1 .o1-tab .o1-tab-glyph { display: none; font-family: var(--font-mono); }
    @container right (max-width: 340px) {
      .opt-1 .o1-tab { padding: 0 8px; font-size: 13px; }
      .opt-1 .o1-tab[data-tab="terminal"] .o1-tab-full { display: none; }
      .opt-1 .o1-tab[data-tab="terminal"] .o1-tab-glyph { display: inline; }
    }

    .opt-1 .o1-head { display: flex; min-height: 44px; flex: none; align-items: center; gap: 8px; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--line); }
    .opt-1 .o1-head > div { min-width: 0; }
    .opt-1 .o1-head b { display: block; font-size: 14px; font-weight: 500; }
    .opt-1 .o1-head small { display: block; font-size: 11px; color: var(--dim); }
    .opt-1 .o1-head .m-pill { flex: none; }

    .opt-1 .o1-card-wrap { margin: 0 12px 12px; }
    .opt-1 .o1-card { position: relative; display: flex; flex-direction: column; width: 100%; min-height: 0; aspect-ratio: 16/10; overflow: visible; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; }
    @supports (aspect-ratio: 1) {
      .opt-1 .o1-card { aspect-ratio: auto; }
    }
    .opt-1 .o1-card::before { content: ""; position: absolute; inset: 0; border-radius: 12px; background: radial-gradient(ellipse at center, rgba(218,174,92,.10), transparent 58%); pointer-events: none; }
    .opt-1 .o1-card-body { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 160px; padding: 20px; text-align: center; }
    .opt-1 .o1-card-inner { max-width: 24rem; }
    .opt-1 .o1-icon { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: var(--amber); }
    .opt-1 .o1-icon svg { width: 24px; height: 24px; stroke-width: 1.5; }
    .opt-1 .o1-eyebrow { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: rgba(255,255,255,.45); }
    .opt-1 .o1-card h2 { margin: 8px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
    .opt-1 .o1-card p { margin: 8px auto 0; max-width: 20rem; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,.65); }
    .opt-1 .o1-start { display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; padding: 8px 16px; font-size: 12px; }
    .opt-1 .o1-foot { position: relative; display: flex; flex: none; justify-content: space-between; gap: 8px; padding: 8px 16px; border-top: 1px solid rgba(255,255,255,.1); font-family: var(--font-mono); font-size: 10px; color: rgba(255,255,255,.45); }
    @container right (max-width: 320px) {
      .opt-1 .o1-icon { width: 40px; height: 40px; margin-bottom: 10px; }
      .opt-1 .o1-icon svg { width: 18px; height: 18px; }
      .opt-1 .o1-eyebrow { display: none; }
      .opt-1 .o1-card p { -webkit-line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
      .opt-1 .o1-start { width: 100%; }
      .opt-1 .o1-card-body { min-height: 0; padding: 16px; }
    }

    .opt-1 .o1-hint { margin: 4px 16px 16px; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-1 .o1-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px 16px; }
    .opt-1 .o1-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-1 .o1-details { margin-top: auto; border-top: 1px solid var(--line); }
    .opt-1 .o1-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-1 .o1-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
    .opt-1 .m-details-row > span:first-child { max-width: 60%; }

    .opt-1 .o1-seam { position: relative; }
    .opt-1 .o1-expand { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2; display: none; align-items: center; justify-content: center; width: 20px; height: 28px; border-radius: 8px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line), var(--shadow-floating); color: var(--dim); }
    .opt-1 .o1-expand svg { width: 14px; height: 14px; }
    .opt-1[data-right-collapsed="true"] .o1-expand { display: flex; }
    .opt-1[data-right-collapsed="true"] .o1-seam { background: transparent; cursor: default; }
    .opt-1[data-right-collapsed="true"] .o1-seam::after { content: none; }

    .opt-1 .o1-note { margin: 10px 16px; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
  `,

  /** Shared right-panel renderer, used by both the full mount and the close-ups. */
  renderPanel(state, { mock, icons }) {
    const tab = (id, label) =>
      `<button type="button" role="tab" class="o1-tab" data-tab="${id}" data-focus="tab-${id}" aria-selected="${state.tab === id}">
        <span class="o1-tab-full">${label}</span>
      </button>`;
    let body;
    if (state.tab === "activity") body = `<div class="m-scroll">${mock.activityBody()}</div>`;
    else if (state.tab === "diff") body = `<div class="m-scroll">${mock.diffBody()}</div>`;
    else if (state.tab === "terminal") body = mock.terminalBody();
    else body = this.renderComputer(state, { mock, icons });
    return `<div class="m-right">
      <div class="o1-tabs">
        <div class="o1-tabs-scroll" role="tablist" aria-label="Right panel (mock)">
          ${tab("activity", "Activity")}${tab("diff", "Diff")}${tab("computer", "Computer")}
          <button type="button" role="tab" class="o1-tab" data-tab="terminal" data-focus="tab-terminal" aria-selected="${state.tab === "terminal"}" aria-label="Terminal">
            <span class="o1-tab-full">Terminal</span><span class="o1-tab-glyph" aria-hidden="true">›_</span>
          </button>
        </div>
      </div>
      ${body}
    </div>`;
  },

  renderComputer(state, { mock, icons }) {
    const c = mock.computerCopy[state.computer];
    const screen =
      state.computer === "live"
        ? `<div class="o1-card-wrap"><div class="m-screen">${mock.liveScreen()}</div></div>`
        : `<div class="o1-card-wrap">
            <div class="o1-card">
              <div class="o1-card-body">
                <div class="o1-card-inner">
                  <div class="o1-icon">${state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor}</div>
                  <div class="o1-eyebrow">${mock.project} · local desktop</div>
                  <h2>${c.title}</h2>
                  <p>${c.description}</p>
                  ${c.action ? `<button type="button" class="o1-start m-btn-amber" data-act="start">${icons.monitor}${c.action}</button>` : ""}
                </div>
              </div>
              <div class="o1-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
            </div>
          </div>`;
    return `<div class="m-scroll" style="display:flex;flex-direction:column">
      <div class="o1-head"><div><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>
      <div style="padding-top:12px">${screen}</div>
      <p class="o1-hint">${c.hint}</p>
      ${
        state.computer === "live"
          ? `<div class="o1-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop">Turn off</button></div>`
          : ""
      }
      <div class="o1-details">
        <div class="o1-details-head"><span class="m-label-mono" style="font-size:11px">Details</span><span>project</span></div>
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

  /** Panel limits: min 260px, max 60% of the window, main panel min 40%.
   * Dragging under ~130px collapses the panel to 0. */
  layout(state) {
    if (state.viewport < 1024) return 0;
    const max = state.viewport * 0.6;
    const w = state.rightWidth;
    if (w < 130) return 0;
    return Math.round(Math.min(max, Math.max(260, w)));
  },

  mount(root, ctx) {
    const { mock, icons } = ctx;
    root.innerHTML = `${mock.topBar()}${mock.sectionTabs()}
      <div class="m-body">
        <div class="o1-main" style="display:flex;flex:1;min-width:0">${mock.mainPanel()}</div>
        <div class="o1-seam" data-seam-wrap>
          <div class="m-seam" data-seam></div>
          <button type="button" class="o1-expand" data-act="expand" aria-label="Show right panel">${icons.chevronDown.replace('class="i"', 'class="i" style="transform:rotate(-90deg)"')}</button>
        </div>
        <div class="o1-right" style="flex:none;min-width:0;overflow:hidden"></div>
      </div>`;
    const right = root.querySelector(".o1-right");
    const seam = root.querySelector("[data-seam]");
    const seamWrap = root.querySelector("[data-seam-wrap]");
    const detachSash = ctx.attachSash(seam, {
      onEnd(state) {
        if (state.rightWidth > 0 && state.rightWidth < 130) ctx.setState({ rightWidth: 0 });
      },
    });
    const unwirePanel = this.wirePanel(right, ctx);
    const onExpandClick = (e) => {
      if (!e.target.closest('[data-act="expand"]')) return;
      ctx.setState({ rightWidth: Math.max(260, Math.round(ctx.getState().viewport * 0.22)) });
    };
    seamWrap.addEventListener("click", onExpandClick);
    let lastKey = "";

    const update = (state) => {
      const w = this.layout(state);
      const vp = state.viewport;
      const hiddenByWindow = vp < 1024;
      seam.hidden = hiddenByWindow;
      root.querySelector(".o1-expand").hidden = hiddenByWindow;
      root.dataset.rightCollapsed = String(!hiddenByWindow && w === 0);
      right.hidden = w === 0;
      right.style.width = `${w}px`;
      const key = `${state.tab}|${state.computer}`;
      if (key !== lastKey) {
        WS.renderKeepFocus(right, this.renderPanel(state, ctx));
        lastKey = key;
      }
      const mainW = vp - (w ? w + 4 : 0);
      ctx.report(
        hiddenByWindow
          ? "Panels hidden at this width (window < 1024px)"
          : w === 0
            ? "Right panel collapsed · drag or click the seam to reopen"
            : `Right panel ${w}px · main ${mainW}px`,
      );
    };
    update(ctx.getState());
    return {
      update,
      destroy() {
        detachSash();
        unwirePanel();
        seamWrap.removeEventListener("click", onExpandClick);
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
