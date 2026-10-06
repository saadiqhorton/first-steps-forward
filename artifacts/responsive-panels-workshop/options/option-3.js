/* Option 3: Snap sizes. The right panel has three designed layouts — compact,
 * standard, wide — instead of one layout trying to flex across every width.
 * See README.md in this folder for the option contract this file implements. */
WS.register({
  id: 3,
  name: "Snap sizes",
  tradeoff:
    "No broken in-between widths, because every size is designed, but resizing is less free and the panel can jump on release.",
  notes: [
    "Three fixed layouts — <b>Compact</b> 280px (icon tabs, stacked status card), <b>Standard</b> 400px (today's 16:10 card, fixed), <b>Wide</b> 600px (screen on top, Details beside the hint) — so no width in between can look half-built.",
    "Dragging follows the pointer in real time, clamped to 280–60% of the window; letting go (or an arrow-key step) animates to the nearest of those sizes. Drag past 140px and it collapses to 0, leaving a small reopen button on the seam.",
    "Below a 1024px window the panel becomes a Compact sheet that overlays the main panel's right edge, opened from a toggle near the top bar and closed with the toggle or Esc.",
    "In code: <code>Shell.tsx</code>'s <code>react-resizable-panels</code> group would snap via <code>onLayoutChanged</code> instead of leaving <code>rightWidth</code> wherever the drag ends, and <code>AgentComputerPane.tsx</code> would take a <code>sizeMode: \"compact\" | \"standard\" | \"wide\"</code> prop (or <code>@container</code> breakpoints at the same 280/400/600 widths) instead of one fixed 16:10 card.",
    "A 320px close-up still maps to Compact and a 480px one to Standard — the two below-1024 mounts Shell ships today.",
  ],
  css: `
    .opt-3 .opt3-toggle { position: absolute; top: 6px; right: 10px; z-index: 30; width: 36px; height: 36px; display: none; align-items: center; justify-content: center; border-radius: 10px; }
    .opt-3.opt3-narrow .opt3-toggle { display: flex; }
    .opt-3.opt3-narrow .m-topbar { padding-right: 56px; }

    .opt-3 .opt3-right-slot { position: relative; }
    .opt-3 .opt3-right-slot[data-sheet="true"] { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; box-shadow: var(--shadow-floating); border-left: 1px solid var(--line); }
    @media (prefers-reduced-motion: no-preference) {
      .opt-3 .opt3-right-slot { transition: width 160ms ease; }
      .opt-3 .m-body:has(.m-seam[data-dragging="true"]) .opt3-right-slot { transition: none; }
    }

    .opt-3 .opt3-reopen { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink); }
    .opt-3 .opt3-reopen svg { width: 13px; height: 13px; }
    @media (prefers-reduced-motion: no-preference) {
      .opt-3 .m-seam[data-dragging="true"]::before { content: ""; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 2px; height: 36px; opacity: 0.45; background: repeating-linear-gradient(to bottom, var(--amber-deep) 0 3px, transparent 3px 9px); }
    }

    /* ---- tabs ---- */
    .opt-3 .opt3-tabs { display: flex; height: 36px; flex: none; border-bottom: 1px solid var(--line); background: var(--panel); }
    .opt-3 .opt3-tab { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; position: relative; font-size: 13px; color: var(--dim); }
    .opt-3 .opt3-tab[aria-selected="true"] { color: var(--ink); }
    .opt-3 .opt3-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; border-radius: 2px; background: var(--amber); }
    .opt-3 .opt3-tab-ic { display: none; }
    .opt-3 .opt3-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .opt-3 .m-right[data-size="compact"] .opt3-tab-ic { display: flex; }
    .opt-3 .m-right[data-size="compact"] .opt3-tab-label { display: none; }

    /* ---- computer tab: shared pieces ---- */
    .opt-3 .opt3-cbody { display: flex; flex-direction: column; }
    .opt-3 .opt3-chead { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 44px; flex: none; padding: 0 14px; border-bottom: 1px solid var(--line); min-width: 0; }
    .opt-3 .opt3-chead-text { min-width: 0; }
    .opt-3 .opt3-chead-text b { display: block; font-size: 13px; font-weight: 500; }
    .opt-3 .opt3-chead-text small { display: block; font-size: 11px; color: var(--dim); }
    .opt-3 .opt3-screenwrap { padding: 12px 14px 0; }
    .opt-3 .opt3-hint { margin: 10px 14px 0; font-size: 12px; line-height: 1.4; color: var(--dim); }
    .opt-3 .opt3-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 14px 0; }
    .opt-3 .opt3-actions button { padding: 6px 12px; font-size: 12px; }
    .opt-3 .opt3-details { margin-top: 14px; border-top: 1px solid var(--line); }
    .opt-3 .opt3-details-head { display: flex; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .opt-3 .opt3-details-head span:last-child { margin-left: auto; font-family: var(--font-mono); font-size: 10px; color: var(--dim); }

    /* card: shared bits (icon/eyebrow/title/desc/start) */
    .opt-3 .opt3-card-icon { display: grid; place-items: center; width: 36px; height: 36px; margin: 0 auto 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: var(--amber); }
    .opt-3 .opt3-card-icon svg { width: 18px; height: 18px; stroke-width: 1.5; }
    .opt-3 .opt3-card-eyebrow { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: rgba(255,255,255,.45); }
    .opt-3 .opt3-card-title { margin: 6px 0 0; font-size: 14px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.25; }
    .opt-3 .opt3-card-desc { margin: 6px auto 0; max-width: 22rem; font-size: 11px; line-height: 1.45; color: rgba(255,255,255,.65); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .opt-3 .opt3-start { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 7px 14px; font-size: 12px; flex: none; }

    /* card: compact — stacked, normal flow, no fixed aspect ratio */
    .opt-3 .opt3-card-stacked { position: relative; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; padding: 14px 14px 12px; text-align: center; }
    .opt-3 .opt3-card-stacked .opt3-start { width: 100%; justify-content: center; }
    .opt-3 .opt3-card-foot { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.1); font-family: var(--font-mono); font-size: 9px; color: rgba(255,255,255,.45); }

    /* card: standard/wide — 16:10 box, footer in flow (not absolute) */
    .opt-3 .opt3-card-box { position: relative; display: flex; flex-direction: column; width: 100%; aspect-ratio: 16 / 10; border-radius: 12px; border: 1px solid var(--line); background: #141716; color: #fff; overflow: hidden; }
    .opt-3 .opt3-card-inner { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 18px; text-align: center; }
    .opt-3 .opt3-card-box .opt3-card-foot { flex: none; display: flex; justify-content: space-between; padding: 7px 14px; border-top: 1px solid rgba(255,255,255,.1); font-family: var(--font-mono); font-size: 9px; color: rgba(255,255,255,.45); }

    /* wide: screen/card on top, two columns below */
    .opt-3 .opt3-cbody-wide .opt3-split { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 0 16px; margin-top: 4px; align-items: start; }
    .opt-3 .opt3-cbody-wide .opt3-split-left { min-width: 0; }
    .opt-3 .opt3-cbody-wide .opt3-split-left .opt3-hint { margin-left: 0; }
    .opt-3 .opt3-cbody-wide .opt3-split-left .opt3-actions { margin-left: 0; }
    .opt-3 .opt3-cbody-wide .opt3-split-right { min-width: 0; }
    .opt-3 .opt3-cbody-wide .opt3-split-right .opt3-details { margin-top: 0; border-top: 0; }
  `,

  SNAPS: [280, 400, 600],
  MODE_NAME: { 280: "compact", 400: "standard", 600: "wide" },

  availableSnaps(viewport) {
    const max = viewport * 0.6;
    const avail = this.SNAPS.filter((s) => s <= max);
    return avail.length ? avail : [this.SNAPS[0]];
  },

  nearestSnapValue(width, viewport) {
    const avail = this.availableSnaps(viewport);
    let best = avail[0];
    for (const s of avail) if (Math.abs(s - width) < Math.abs(best - width)) best = s;
    return best;
  },

  modeForWidth(width, viewport) {
    return this.MODE_NAME[this.nearestSnapValue(width, viewport)];
  },

  cardStacked(state, c, icons, mock) {
    const icon = state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor;
    return `<div class="opt3-card-stacked">
      <div class="opt3-card-icon">${icon}</div>
      <div class="opt3-card-eyebrow">${mock.project}</div>
      <h2 class="opt3-card-title">${c.title}</h2>
      <p class="opt3-card-desc">${c.description}</p>
      ${c.action ? `<button type="button" class="opt3-start m-btn-amber" data-act="start" data-focus="start">${icons.monitor}${c.action}</button>` : ""}
      <div class="opt3-card-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
    </div>`;
  },

  cardBox(state, c, icons, mock) {
    const icon = state.computer === "starting" ? icons.loader.replace('class="i"', 'class="i m-spin"') : icons.monitor;
    return `<div class="opt3-card-box">
      <div class="opt3-card-inner">
        <div class="opt3-card-icon">${icon}</div>
        <div class="opt3-card-eyebrow">${mock.project}</div>
        <h2 class="opt3-card-title">${c.title}</h2>
        <p class="opt3-card-desc">${c.description}</p>
        ${c.action ? `<button type="button" class="opt3-start m-btn-amber" data-act="start" data-focus="start">${icons.monitor}${c.action}</button>` : ""}
      </div>
      <div class="opt3-card-foot"><span>${c.footerLeft}</span><span>${c.footerRight}</span></div>
    </div>`;
  },

  renderComputer(mode, state, ctx) {
    const { mock, icons } = ctx;
    const c = mock.computerCopy[state.computer];
    const isLive = state.computer === "live";
    const screen = isLive
      ? `<div class="m-screen">${mock.liveScreen()}</div>`
      : mode === "compact"
        ? this.cardStacked(state, c, icons, mock)
        : this.cardBox(state, c, icons, mock);
    const header = `<div class="opt3-chead"><div class="opt3-chead-text"><b>Agent computer</b><small class="m-truncate">${mock.project}</small></div>${mock.statusPill(state.computer)}</div>`;
    const hint = `<p class="opt3-hint">${c.hint}</p>`;
    const actions = isLive
      ? `<div class="opt3-actions"><button type="button" class="m-btn-quiet">Take control</button><button type="button" class="m-btn-quiet">Full screen</button><button type="button" class="m-btn-quiet" data-act="stop" data-focus="stop">Turn off</button></div>`
      : "";
    const details = `<div class="opt3-details"><div class="opt3-details-head"><span class="m-label-mono">Details</span><span>project</span></div>${mock.detailsRows()}</div>`;

    if (mode === "wide") {
      return `<div class="opt3-cbody opt3-cbody-wide">
        ${header}
        <div class="opt3-screenwrap">${screen}</div>
        <div class="opt3-split">
          <div class="opt3-split-left">${hint}${actions}</div>
          <div class="opt3-split-right">${details}</div>
        </div>
      </div>`;
    }
    return `<div class="opt3-cbody">
      ${header}
      <div class="opt3-screenwrap">${screen}</div>
      ${hint}
      ${actions}
      ${details}
    </div>`;
  },

  renderTabs(mode, state, ctx) {
    return `<div class="opt3-tabs" role="tablist" aria-label="Right panel (mock)">
      ${ctx.mock.rightTabs
        .map(
          (t) =>
            `<button type="button" role="tab" class="opt3-tab" data-tab="${t.id}" data-focus="tab-${t.id}" aria-selected="${state.tab === t.id}" aria-label="${t.label}">
              <span class="opt3-tab-ic" aria-hidden="true">${t.icon}</span>
              <span class="opt3-tab-label">${t.label}</span>
            </button>`,
        )
        .join("")}
    </div>`;
  },

  renderBody(mode, state, ctx) {
    if (state.tab === "activity") return `<div class="m-scroll">${ctx.mock.activityBody()}</div>`;
    if (state.tab === "diff") return `<div class="m-scroll">${ctx.mock.diffBody()}</div>`;
    if (state.tab === "terminal") return ctx.mock.terminalBody();
    return `<div class="m-scroll">${this.renderComputer(mode, state, ctx)}</div>`;
  },

  /** The right panel at a given designed size. Shared by the full mount and the close-ups. */
  renderRight(mode, state, ctx) {
    return `<div class="m-right" data-size="${mode}">${this.renderTabs(mode, state, ctx)}${this.renderBody(mode, state, ctx)}</div>`;
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

  mount(root, ctx) {
    const { mock, icons } = ctx;
    root.innerHTML = `${mock.topBar()}${mock.sectionTabs()}
      <button type="button" class="opt3-toggle m-btn-quiet" data-act="toggle-sheet" aria-label="Open right panel" aria-expanded="false" hidden>${icons.panelOpen}</button>
      <div class="m-body">
        <div class="opt3-main" style="display:flex;flex:1;min-width:0">${mock.mainPanel()}</div>
        <div class="m-seam" data-seam>
          <button type="button" class="opt3-reopen" data-act="reopen" data-focus="reopen" aria-label="Reopen right panel" hidden>${icons.panelOpen}</button>
        </div>
        <div class="opt3-right-slot" style="flex:none;overflow:hidden"></div>
      </div>`;

    const slot = root.querySelector(".opt3-right-slot");
    const seam = root.querySelector("[data-seam]");
    const reopenBtn = root.querySelector(".opt3-reopen");
    const toggleBtn = root.querySelector(".opt3-toggle");

    const onEnd = (state) => {
      const raw = state.rightWidth;
      if (raw === 0) return;
      if (raw < 140) {
        ctx.setState({ rightWidth: 0 });
        return;
      }
      const avail = state.viewport * 0.6;
      const clamped = Math.max(280, Math.min(avail, raw));
      const snapped = this.nearestSnapValue(clamped, state.viewport);
      if (snapped !== raw) ctx.setState({ rightWidth: snapped });
    };
    const detachSash = ctx.attachSash(seam, { onEnd });
    const unwirePanel = this.wirePanel(slot, ctx);

    const onRootClick = (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      if (t.dataset.act === "reopen") ctx.setState({ rightWidth: 400 });
      if (t.dataset.act === "toggle-sheet") ctx.setState({ sheetOpen: !ctx.getState().sheetOpen });
    };
    root.addEventListener("click", onRootClick);

    const onKeydown = (e) => {
      if (e.key === "Escape" && ctx.getState().sheetOpen) ctx.setState({ sheetOpen: false });
    };
    document.addEventListener("keydown", onKeydown);

    let lastKey = "";
    const update = (state) => {
      const vp = state.viewport;
      const narrow = vp < 1024;
      root.classList.toggle("opt3-narrow", narrow);
      seam.hidden = narrow;
      toggleBtn.hidden = !narrow;
      toggleBtn.setAttribute("aria-expanded", String(!!state.sheetOpen));

      let mode, renderedWidth, showSlot;
      if (narrow) {
        mode = "compact";
        renderedWidth = 280;
        slot.dataset.sheet = "true";
        showSlot = !!state.sheetOpen;
        reopenBtn.hidden = true;
      } else {
        slot.dataset.sheet = "false";
        const raw = state.rightWidth;
        if (raw === 0) {
          mode = null;
          renderedWidth = 0;
          showSlot = false;
          reopenBtn.hidden = false;
        } else {
          const avail = vp * 0.6;
          renderedWidth = Math.round(Math.max(280, Math.min(avail, raw)));
          mode = this.modeForWidth(renderedWidth, vp);
          showSlot = true;
          reopenBtn.hidden = true;
        }
      }
      slot.hidden = !showSlot;
      slot.style.width = mode ? `${renderedWidth}px` : "0px";
      if (mode) slot.dataset.size = mode;

      const key = mode ? `${mode}|${state.tab}|${state.computer}|${narrow}` : "collapsed";
      if (mode && key !== lastKey) {
        WS.renderKeepFocus(slot, this.renderRight(mode, state, ctx));
      }
      lastKey = key;

      ctx.report(
        narrow
          ? `Window < 1024px: right panel ${state.sheetOpen ? "open" : "closed"} sheet · compact`
          : renderedWidth === 0
            ? "Right panel collapsed"
            : `Right panel ${renderedWidth}px · ${mode}`,
      );
    };
    update(ctx.getState());
    return {
      update,
      destroy() {
        detachSash();
        unwirePanel();
        root.removeEventListener("click", onRootClick);
        document.removeEventListener("keydown", onKeydown);
      },
    };
  },

  mountPanel(root, ctx) {
    const unwire = this.wirePanel(root, ctx);
    let lastKey = "";
    const update = (state) => {
      const mode = this.modeForWidth(state.rightWidth, state.viewport);
      const key = `${mode}|${state.tab}|${state.computer}`;
      if (key !== lastKey) {
        WS.renderKeepFocus(root, this.renderRight(mode, state, ctx));
        lastKey = key;
      }
      ctx.report(`Right panel ${state.rightWidth}px · ${mode}`);
    };
    update(ctx.getState());
    return { update, destroy: unwire };
  },
});
