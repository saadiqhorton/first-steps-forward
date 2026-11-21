/* Option 3 — Ledger: the Settings/Inbox page pattern. A composer on top and a
 * grouped card of changes; selecting a row expands it in place. */
(function () {
  "use strict";
  const { icons, P, SAMPLE, esc } = WS;

  const STEPS = ["Building", "Checks", "Try it", "Keep it"];
  function stepStates(s) {
    // index of the current step, and whether it is running
    const map = { building: [0, "run"], checking: [1, "run"], failed: [1, "bad"], ready: [2, "now"], switching: [3, "run"], kept: [4, "done"] };
    const [cur, mode] = map[s.phase] || [-1, ""];
    return STEPS.map((label, i) => ({ label, st: i < cur ? "pass" : i === cur ? mode : "wait" }));
  }

  function stepsHtml(s) {
    return `<ol class="o3-steps" aria-label="Progress">${stepStates(s)
      .map(
        (x, i) => `<li class="o3-step" data-st="${x.st}"><span class="o3-step-mark">${
          x.st === "pass" ? icons.check : x.st === "run" ? `<span class="a-spin" style="display:grid">${icons.loader}</span>` : x.st === "bad" ? icons.x : i + 1
        }</span><span>${x.label}</span></li>`,
      )
      .join("")}</ol>`;
  }

  function activeRow(s, open) {
    const title = WS.changeTitle(s);
    const body = !open
      ? ""
      : `<div class="o3-detail">
          ${stepsHtml(s)}
          ${s.phase === "switching" ? P.switching(s) : P.checks(s)}
          ${s.previewOpen && s.phase === "ready" ? P.preview(s) + `<div><button type="button" class="a-btn is-ghost" data-act="close-preview" data-focus="close-preview">${icons.x}Close preview</button></div>` : ""}
          ${P.actions(s)}
          <button type="button" class="o3-link" data-act="conv" data-focus="show-conv" aria-expanded="${!!s.ui.conv}">${icons.chat}${s.ui.conv ? "Hide conversation" : "Show conversation"}</button>
          ${s.ui.conv ? P.thread(s) : ""}
        </div>`;
    return `<div class="o3-item" data-open="${open}" data-role="active-row">
      <button type="button" class="o3-main" data-act="toggle" data-id="active" data-focus="row-active" aria-expanded="${open}">
        <span class="o3-chev">${open ? icons.chevronDown : icons.chevronRight}</span>
        <span class="a-row-text"><span class="a-row-title">${esc(title)}</span><span class="a-row-sub">${s.phase === "failed" ? "Tests failed · the agent is fixing this" : s.phase === "ready" ? "All checks passed · try it, then keep it" : "Claude Code · just now"}</span></span>
        ${P.phasePill(s)}
      </button>${body}</div>`;
  }

  WS.defineOption({
    id: 3,
    name: "Ledger",
    tradeoff: "The calmest and simplest, reading like Settings, but with the least room to steer the agent.",
    notes: [
      "The Inbox and Settings pattern: mono breadcrumb, title, grey description, then one grouped card. Nothing here looks new.",
      "A <b>Describe a change</b> composer sits on top. Each change is a row with a status pill; the row being worked on opens by itself.",
      "Selecting a row expands it in place with four steps (<b>Building, Checks, Try it, Keep it</b>), the checks, and the actions.",
      "The conversation is tucked behind <b>Show conversation</b>. That keeps the page quiet and makes refining hard, which is the tradeoff.",
      "Kept changes sit in the same card with <b>Remove</b> on the row, so Your changes needs no second place.",
    ],
    css: `
      .opt-3 .o3-page { max-width: 800px; }
      .opt-3 .o3-item + .o3-item, .opt-3 .a-card > * + * { border-top: 1px solid var(--line); }
      .opt-3 .o3-main { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; min-height: 64px; text-align: left; }
      .opt-3 .o3-main:hover { background: color-mix(in oklab, var(--ink) 3%, transparent); }
      .opt-3 .o3-chev { color: var(--dim); display: grid; }
      .opt-3 .o3-chev svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-detail { display: grid; gap: 12px; padding: 4px 16px 16px 42px; }
      .opt-3 .o3-steps { display: flex; gap: 6px; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
      .opt-3 .o3-step { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); padding-right: 12px; }
      .opt-3 .o3-step + .o3-step::before { content: ""; width: 16px; height: 1px; background: var(--line); margin-right: 6px; }
      .opt-3 .o3-step-mark { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--line); font-size: 11px; font-family: var(--font-mono); }
      .opt-3 .o3-step-mark svg.i { width: 12px; height: 12px; }
      .opt-3 .o3-step[data-st="pass"] { color: var(--ink); }
      .opt-3 .o3-step[data-st="pass"] .o3-step-mark { background: color-mix(in oklab, var(--teal) 14%, transparent); border-color: var(--teal); color: var(--teal); }
      .opt-3 .o3-step[data-st="run"], .opt-3 .o3-step[data-st="now"] { color: var(--ink); font-weight: 500; }
      .opt-3 .o3-step[data-st="run"] .o3-step-mark { border-color: var(--teal); color: var(--teal); }
      .opt-3 .o3-step[data-st="now"] .o3-step-mark { border-color: var(--amber); background: color-mix(in oklab, var(--amber) 18%, transparent); }
      .opt-3 .o3-step[data-st="bad"] { color: var(--danger); font-weight: 500; }
      .opt-3 .o3-step[data-st="bad"] .o3-step-mark { border-color: var(--danger); }
      .opt-3 .o3-link { display: inline-flex; align-items: center; gap: 6px; width: fit-content; font-size: 12px; color: var(--dim); }
      .opt-3 .o3-link:hover { color: var(--ink); }
      .opt-3 .o3-link svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-composer { display: grid; gap: 8px; margin-top: 20px; }
      .opt-3[data-width="phone"] .o3-detail { padding-left: 16px; }
      .opt-3[data-width="phone"] .a-actions .a-btn { flex: 1; }
      .opt-3[data-width="phone"] .a-page-head { flex-direction: column; }
    `,
    act: {
      toggle: (el, ev, eng, ctx, ui) => {
        const s = ctx.getState();
        const cur = s.ui.open === undefined ? "active" : s.ui.open;
        ui({ open: cur === el.dataset.id ? null : el.dataset.id });
      },
      conv: (el, ev, eng, ctx, ui) => ui({ conv: !ctx.getState().ui.conv }),
      "close-preview": (el, ev, eng) => eng.closePreview(),
    },
    render(s) {
      const ready = s.setup === "done";
      const openId = s.ui.open === undefined ? "active" : s.ui.open;
      const showActive = WS.hasActive(s) && s.phase !== "kept";
      const rows = [];
      if (showActive) rows.push(activeRow(s, openId === "active"));
      s.kept.forEach((k, i) => {
        const justKept = s.phase === "kept" && i === 0;
        rows.push(`<div class="o3-item">${P.keptRow(s, k)}${justKept ? `<div class="o3-detail" style="padding-left:42px">${P.kept(s)}</div>` : ""}</div>`);
      });
      return `${P.topbar(s)}
        <div class="a-page" data-scroll="o3-page"><div class="o3-page">
          <div class="a-page-head">
            <div><span class="a-crumb">Workspace / customize</span>
              <h1 class="a-title">Customize ADE</h1>
              <p class="a-desc">Describe a change and an agent builds it in a private copy of ADE. You try it before you keep it.</p></div>
            ${P.statusHtml(s)}
          </div>
          ${s.update ? `<div style="margin-top:20px">${P.updateBanner(s)}</div>` : ""}
          ${
            ready
              ? `<div class="o3-composer"><span class="a-group-label" style="margin:0">Describe a change</span>${P.composer(s)}</div>
                 <div class="a-group-label">Your changes</div>
                 <div class="a-card" data-role="ledger">${rows.length ? rows.join("") : `<div class="a-empty">Nothing yet. Changes you keep show up here.</div>`}</div>
                 <div style="margin-top:12px">${P.stockHint()}</div>`
              : `<div style="margin-top:24px">${P.setup(s)}</div>`
          }
        </div></div>
        ${P.notice(s)}`;
    },
  });
})();
