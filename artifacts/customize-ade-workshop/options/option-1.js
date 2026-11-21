/* Option 1 — Conversation: Luna's page, for changes. The lifecycle lives in a
 * change card inside the agent's reply; "Your changes" opens as a sheet. */
(function () {
  "use strict";
  const { icons, P, SAMPLE, esc } = WS;

  function changeCard(s) {
    if (!s.request || s.phase === "building") return "";
    const body =
      s.phase === "switching"
        ? P.switching(s)
        : s.phase === "kept"
          ? P.kept(s)
          : P.checks(s);
    return `<section class="a-changecard" aria-label="Change: ${esc(WS.changeTitle(s))}" data-role="change-card">
      <div class="a-changecard-head"><h3>${esc(WS.changeTitle(s))}</h3>${P.phasePill(s)}</div>
      ${body}
      ${s.previewOpen && s.phase === "ready" ? P.preview(s) : ""}
      ${s.previewOpen && s.phase === "ready" ? `<div><button type="button" class="a-btn is-ghost" data-act="close-preview" data-focus="close-preview">${icons.x}Close preview</button></div>` : ""}
      ${P.actions(s)}
    </section>`;
  }

  function sheet(s) {
    const inProgress = WS.hasActive(s) && s.phase !== "kept"
      ? `<div><div class="a-group-label" style="margin-top:0">In progress</div><div class="a-card"><div class="a-kept"><span class="a-dot" data-tone="${s.phase === "failed" ? "bad" : s.phase === "ready" ? "warn" : "ok"}"></span>
          <div class="a-kept-text"><span class="a-kept-title">${esc(WS.changeTitle(s))}</span><span class="a-kept-sub">Not kept yet</span></div>${P.phasePill(s)}</div></div></div>`
      : "";
    return P.sheet({
      title: "Your changes",
      bottom: s.width === "phone",
      close: "close-sheet",
      body: `${inProgress}<div><div class="a-group-label" style="margin-top:0">Kept</div>${P.yourChanges(s)}</div>${P.stockHint()}`,
    });
  }

  WS.defineOption({
    id: 1,
    name: "Conversation",
    recommended: true,
    tradeoff: "The most familiar and the lightest, but kept changes are one click away in a sheet.",
    notes: [
      "The page is Luna's page (breadcrumb, title, status line, one header row, centered thread over a composer) with the live start screen as its empty state: a display heading, three suggestion cards, then the composer.",
      "The change lifecycle is a <b>change card</b> inside the agent's reply: checks, then <b>Try it</b>, <b>Keep it</b> and <b>Undo</b>. Try it opens the preview inside the card.",
      "<b>Your changes</b> is a header button that opens a sheet (a bottom sheet on a phone) with each kept change and its Remove. History is folded into it, since changes are the history.",
      "The top-bar tab shows the state when you are elsewhere in ADE: a teal pulse while building, an amber dot when a change is ready or an update needs you.",
      "Weakness: once the thread grows, a kept change from last week is two clicks away and the thread buries the state of the last one.",
    ],
    css: `
      .opt-1 .o1-head { flex: none; border-bottom: 1px solid var(--line); padding: 24px 16px 16px; }
      .opt-1 .o1-head-in { max-width: 768px; margin: 0 auto; display: grid; gap: 12px; }
      .opt-1 .o1-head-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .opt-1 .o1-head-row .a-pill { margin-right: auto; font-size: 12px; color: var(--dim); }
      .opt-1 .o1-main { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 16px; }
      .opt-1 .o1-main-in { max-width: 768px; margin: 0 auto; display: grid; gap: 12px; align-content: start; }
      .opt-1 .o1-foot { flex: none; border-top: 1px solid var(--line); padding: 16px; }
      .opt-1 .o1-foot-in { max-width: 768px; margin: 0 auto; }
      .opt-1 .o1-count { font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-1 .a-changecard { max-width: 672px; }
      .opt-1[data-width="phone"] .o1-label { display: none; }
      .opt-1[data-width="phone"] .o1-head { padding: 20px 16px 14px; }
      .opt-1[data-width="phone"] .a-btn.o1-hbtn { width: 36px; height: 36px; padding: 0; border-radius: 12px; }
      .opt-1[data-width="phone"] .a-btn.o1-hbtn.has-count { width: auto; padding: 0 8px; gap: 4px; }
      .opt-1[data-width="phone"] .a-actions .a-btn { flex: 1; }
    `,
    act: {
      "open-sheet": (el, ev, eng, ctx, ui) => ui({ sheetOpen: true }),
      "close-sheet": (el, ev, eng, ctx, ui) => ui({ sheetOpen: false }),
      "close-preview": (el, ev, eng) => eng.closePreview(),
    },
    render(s) {
      const ready = s.setup === "done";
      const n = s.kept.length;
      const start = ready && s.phase === "idle" && !s.request;
      return `${P.topbar(s)}
        <div class="o1-head"><div class="o1-head-in">
          <span class="a-crumb">Workspace / customize</span>
          <h1 class="a-title">Customize ADE</h1>
          <div class="o1-head-row">
            ${P.statusHtml(s)}
            <button type="button" class="a-btn o1-hbtn has-count" data-act="open-sheet" data-focus="open-sheet" aria-label="Your changes, ${n}" aria-haspopup="dialog">${icons.list}<span class="o1-label">Your changes</span><span class="o1-count">${n}</span></button>
            <button type="button" class="a-btn o1-hbtn" data-act="new-change" data-focus="new-change" aria-label="New change" ${s.phase !== "kept" ? "disabled" : ""}>${icons.plus}<span class="o1-label">New change</span></button>
          </div>
        </div></div>
        <div class="o1-main" data-scroll="o1-main" data-stick><div class="o1-main-in">
          ${P.updateBanner(s)}
          ${!ready ? P.setup(s) : start ? P.start(s, { composer: P.composer(s) }) : P.thread(s) + changeCard(s)}
        </div></div>
        ${ready && !start ? `<div class="o1-foot"><div class="o1-foot-in">${P.composer(s, { placeholder: "Describe a change to ADE" })}</div></div>` : ""}
        ${s.ui.sheetOpen ? sheet(s) : ""}
        ${P.notice(s)}`;
    },
  });
})();
