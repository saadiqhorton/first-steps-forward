/* Option 4 — Guided: one change at a time. A step track and one focused card
 * per step, with Your changes listed below. */
(function () {
  "use strict";
  const { icons, P, SAMPLE, esc } = WS;

  const STEPS = [
    ["Describe", "Say what ADE should do differently"],
    ["Build", "The agent builds it and runs the checks"],
    ["Try", "Use it in a preview before you decide"],
    ["Keep", "Switch ADE to your version"],
  ];
  const currentStep = (s) =>
    ({ idle: 0, building: 1, checking: 1, failed: 1, ready: 2, switching: 3, kept: 4 })[s.phase];

  function track(s) {
    const cur = currentStep(s);
    return `<ol class="o4-track" aria-label="Steps">${STEPS.map(([label], i) => {
      const st = i < cur ? "done" : i === cur ? "now" : "wait";
      const bad = i === cur && s.phase === "failed" ? ' data-bad="true"' : "";
      return `<li class="o4-tstep" data-st="${st}"${bad} ${st === "now" ? 'aria-current="step"' : ""}>
        <span class="o4-tnum">${st === "done" ? icons.check : i + 1}</span><span class="o4-tlabel">${label}</span></li>`;
    }).join("")}</ol>`;
  }

  function card(s) {
    const cur = currentStep(s);
    const head = (h, p, pill = "") => `<div class="o4-head"><div><h2>${h}</h2><p class="a-desc">${p}</p></div>${pill}</div>`;
    if (cur === 0)
      return `<section class="o4-card is-start" aria-label="Describe">
        ${P.start(s, {
          composer: P.composer(s, { send: false }),
          extra: `<div class="a-actions"><button type="button" class="a-btn is-primary is-lg" data-act="submit" data-focus="build" ${s.draft.trim() ? "" : "disabled"}>Build it</button>
            <span class="a-hint">Takes about a minute. Nothing changes in your ADE yet.</span></div>`,
        })}
      </section>`;
    if (cur === 1)
      return `<section class="o4-card" aria-label="Build">
        ${head(s.phase === "failed" ? "A check failed" : s.phase === "building" ? "Building your change" : "Checking your change", s.phase === "failed" ? "The agent is fixing this. You can keep waiting or undo." : "In a private copy of ADE. Your live ADE isn't touched.", P.phasePill(s))}
        ${P.thread(s)}
        ${s.phase !== "building" ? P.checks(s) : ""}
        ${P.actions(s)}
      </section>`;
    if (cur === 2) {
      const tried = s.tried;
      return `<section class="o4-card" aria-label="Try">
        ${head("Try it before you keep it", "Opens a second ADE on 127.0.0.1:3101 with test data. Your real workspace isn't in it.", P.phasePill(s))}
        ${s.previewOpen ? P.preview(s) : P.thread(s)}
        <div class="a-actions" role="group" aria-label="Change actions">
          ${
            tried
              ? `<button type="button" class="a-btn is-primary is-lg" data-act="keep" data-focus="act-keep">${icons.check}Keep it</button>
                 <button type="button" class="a-btn is-lg" data-act="close-preview" data-focus="close-preview">Close preview</button>`
              : `<button type="button" class="a-btn is-primary is-lg" data-act="try" data-focus="act-try">${icons.eye}Try it</button>
                 <button type="button" class="a-btn is-lg" data-act="keep" data-focus="act-keep">${icons.check}Keep it</button>`
          }
          <button type="button" class="a-btn is-lg" data-act="undo" data-focus="act-undo">${icons.undo}Undo</button>
        </div>
      </section>`;
    }
    if (cur === 3)
      return `<section class="o4-card" aria-label="Keep">
        ${head("Switching to your version", "ADE restarts and this page reconnects by itself.", P.phasePill(s))}
        ${P.switching(s)}</section>`;
    return `<section class="o4-card" aria-label="Keep">
      ${head("Done", `“${esc(WS.changeTitle(s))}” is part of your ADE.`)}
      ${P.kept(s)}
      <div class="a-actions"><button type="button" class="a-btn is-lg" data-act="new-change" data-focus="new-change">${icons.plus}Make another change</button></div>
    </section>`;
  }

  WS.defineOption({
    id: 4,
    name: "Guided",
    tradeoff: "The clearest for first-timers, one decision at a time, but rigid when you want to go back and forth with the agent.",
    notes: [
      "A step track (<b>Describe, Build, Try, Keep</b>) says where you are and what is next. One card per step, one big primary action.",
      "Build has no primary action on purpose: it shows the checks and a quiet Undo. If a check fails, the step turns red and Keep it never appears early.",
      "On Try the primary is <b>Try it</b>; once you have tried, it becomes <b>Keep it</b>. Keep shows the switch in plain words, then <b>You're on your version</b>.",
      "<b>Your changes</b> is listed below the card, always, with Remove. The first-run setup is the same card shape.",
      "Weakness: refining means Undo and start over. There is no thread to push back on.",
    ],
    css: `
      .opt-4 .o4-page { max-width: 760px; display: grid; gap: 20px; }
      .opt-4 .o4-track { display: flex; align-items: center; gap: 0; margin: 0; padding: 0; list-style: none; }
      .opt-4 .o4-tstep { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 13px; color: var(--dim); }
      .opt-4 .o4-tstep:last-child { flex: none; }
      .opt-4 .o4-tstep:not(:last-child)::after { content: ""; flex: 1; height: 1px; margin: 0 12px; background: var(--line); }
      .opt-4 .o4-tnum { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line); font-family: var(--font-mono); font-size: 11.5px; flex: none; }
      .opt-4 .o4-tnum svg.i { width: 13px; height: 13px; }
      .opt-4 .o4-tstep[data-st="done"] { color: var(--ink); }
      .opt-4 .o4-tstep[data-st="done"] .o4-tnum { border-color: var(--teal); color: var(--teal); background: color-mix(in oklab, var(--teal) 12%, transparent); }
      .opt-4 .o4-tstep[data-st="now"] { color: var(--ink); font-weight: 500; }
      .opt-4 .o4-tstep[data-st="now"] .o4-tnum { border-color: var(--amber); background: color-mix(in oklab, var(--amber) 22%, transparent); }
      .opt-4 .o4-tstep[data-bad="true"] .o4-tnum { border-color: var(--danger); background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); }
      .opt-4 .o4-card.is-start { border: 0; background: transparent; padding: 0; }
      .opt-4 .o4-card { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
      .opt-4 .o4-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .opt-4 .o4-head h2 { font-family: var(--font-display); font-size: 18px; font-weight: 500; letter-spacing: -0.02em; }
      .opt-4 .o4-head > div { display: grid; gap: 4px; }
      .opt-4 .a-composer-bar { padding-bottom: 8px; }
      .opt-4 .o4-card .a-msg { font-size: 14px; }
      .opt-4[data-width="phone"] .o4-tlabel { display: none; }
      .opt-4[data-width="phone"] .o4-tstep[data-st="now"] .o4-tlabel { display: inline; }
      .opt-4[data-width="phone"] .o4-tstep:not(:last-child)::after { margin: 0 6px; min-width: 8px; }
      .opt-4[data-width="phone"] .o4-card { padding: 16px; }
      .opt-4[data-width="phone"] .a-actions .a-btn { flex: 1; }
      .opt-4[data-width="phone"] .o4-head { flex-direction: column; }
    `,
    act: {
      "close-preview": (el, ev, eng) => eng.closePreview(),
    },
    render(s) {
      const ready = s.setup === "done";
      return `${P.topbar(s)}
        <div class="a-page" data-scroll="o4-page"><div class="o4-page">
          <div class="a-page-head">
            <div><span class="a-crumb">Workspace / customize</span>
              <h1 class="a-title">Customize ADE</h1>
              <p class="a-desc">Change what ADE does, one change at a time. You always try it before you keep it.</p></div>
            ${P.statusHtml(s)}
          </div>
          ${P.updateBanner(s)}
          ${ready ? track(s) + card(s) : P.setup(s)}
          ${ready ? `<div><div class="a-group-label" style="margin-top:4px">Your changes</div>${P.yourChanges(s)}<div style="margin-top:12px">${P.stockHint()}</div></div>` : ""}
        </div></div>
        ${P.notice(s)}`;
    },
  });
})();
