/* Option 2 — Workbench: the project-shell layout. A rail of changes, the
 * selected change's conversation, and a right pane with Preview, Checks, Changes. */
(function () {
  "use strict";
  const { icons, P, SAMPLE, esc } = WS;

  function items(s) {
    const out = [];
    const needsUpdate = s.update?.kind === "needs" && s.update.status === "pending";
    if (WS.hasActive(s) && s.phase !== "kept") {
      const group = s.phase === "ready" ? "Ready to try" : s.phase === "failed" ? "Needs you" : "In progress";
      out.push({ id: "active", title: WS.changeTitle(s), sub: "Claude Code · just now", group, pill: s.phase });
    }
    s.kept.forEach((k) =>
      out.push({
        id: k.id,
        title: k.title,
        sub: `Claude Code · ${k.when}`,
        group: needsUpdate && k.id === SAMPLE.keptFirst.id ? "Needs you" : "Kept",
        pill: needsUpdate && k.id === SAMPLE.keptFirst.id ? "needs" : "kept",
      }),
    );
    if (s.ui.showRemoved)
      s.removed.forEach((k) => out.push({ id: "rm-" + k.id, title: k.title, sub: `Claude Code · ${k.when}`, group: "Removed", pill: "removed", removed: true }));
    return out;
  }

  const FILTERS = [["all", "All"], ["needs", "Needs you"], ["working", "Working"], ["kept", "Kept"]];
  const inFilter = (i, f) =>
    f === "all" || (f === "needs" && ["Needs you", "Ready to try"].includes(i.group)) || (f === "working" && i.group === "In progress") || (f === "kept" && i.group === "Kept");

  function selection(s, list) {
    const sel = s.ui.sel;
    if (sel && list.some((i) => i.id === sel)) return sel;
    if (sel === "active" && s.phase === "kept") return s.kept[0]?.id;
    return list.find((i) => i.id === "active")?.id || (s.phase === "idle" || !list.length ? "new" : list[0].id);
  }

  function rail(s, list, sel) {
    const filter = s.ui.filter || "all";
    const q = (s.ui.q || "").trim().toLowerCase();
    const shown = list.filter((i) => inFilter(i, filter) && (!q || i.title.toLowerCase().includes(q)));
    const order = ["In progress", "Ready to try", "Needs you", "Kept", "Removed"];
    const groups = order
      .map((g) => ({ g, rows: shown.filter((i) => i.group === g) }))
      .filter((x) => x.rows.length)
      .map(
        ({ g, rows }) => `<div class="o2-group" role="group" aria-label="${g}">${filter === "all" ? `<div class="o2-group-label">${g}<span>${rows.length}</span></div>` : ""}
        ${rows
          .map(
            (r) => `<button type="button" class="o2-item${r.id === sel ? " is-selected" : ""}" data-act="select" data-id="${esc(r.id)}" data-focus="item-${esc(r.id)}" aria-pressed="${r.id === sel}" ${r.removed ? "disabled" : ""}>
              <span class="o2-item-title">${esc(r.title)}</span>
              <span class="o2-item-sub"><span>${esc(r.sub)}</span>${r.removed ? '<span class="a-pill">Removed</span>' : P.pill(r.pill)}</span></button>`,
          )
          .join("")}</div>`,
      )
      .join("");
    const n = s.kept.length + (WS.hasActive(s) && s.phase !== "kept" ? 1 : 0);
    return `<aside class="o2-rail" aria-label="Changes">
      <div class="o2-rail-head"><h2>Changes</h2>
        <button type="button" class="a-icon-btn" data-act="new-change" data-focus="rail-new" aria-label="New change" ${s.phase === "idle" || s.phase === "kept" ? "" : "disabled"}>${icons.plus}</button></div>
      <label class="o2-search">${icons.search || ""}<input type="search" data-act="rail-search" data-focus="rail-search" placeholder="Search changes" aria-label="Search changes" value="${esc(s.ui.q || "")}"></label>
      <div class="o2-filters" role="group" aria-label="Filter">${FILTERS.map(([id, label]) => `<button type="button" class="o2-pill" data-act="filter" data-id="${id}" data-focus="f-${id}" aria-pressed="${filter === id}">${label}</button>`).join("")}</div>
      <div class="o2-groups" data-scroll="o2-rail">${groups || `<p class="a-empty">No changes here.</p>`}</div>
      <div class="o2-rail-foot"><span>${n} ${n === 1 ? "change" : "changes"}</span>
        <label class="o2-check"><input type="checkbox" data-act="show-removed" data-focus="show-removed" ${s.ui.showRemoved ? "checked" : ""}> Show removed</label></div>
    </aside>`;
  }

  function middle(s, sel) {
    const kept = s.kept.find((k) => k.id === sel);
    const live = !kept && WS.hasActive(s) && s.phase !== "kept";
    const startScreen = s.setup === "done" && !kept && !s.request;
    if (startScreen)
      return `<section class="o2-mid" aria-label="New change">
        <div class="o2-mid-body" data-scroll="o2-mid"><div class="o2-mid-in is-start">${P.updateBanner(s)}${P.start(s, { composer: P.composer(s) })}</div></div></section>`;
    const title = kept ? kept.title : WS.changeTitle(s);
    const pill = kept ? P.pill("kept") : P.phasePill(s);
    let body;
    if (s.setup !== "done") body = P.setup(s);
    else if (kept) body = P.keptThread(kept);
    else body = P.thread(s);
    const bar =
      s.phase === "switching" && !kept
        ? P.switching(s)
        : s.phase === "kept" && !kept
          ? P.kept(s)
          : live
            ? P.actions(s)
            : "";
    return `<section class="o2-mid" aria-label="Change conversation">
      <div class="o2-mid-head"><span class="a-crumb">Workspace / customize</span>
        <div class="o2-mid-title"><h1 class="a-title">${esc(title)}</h1>${pill}</div>
        <div class="o2-mid-meta">${P.statusHtml(s)}</div></div>
      <div class="o2-mid-body" data-scroll="o2-mid" data-stick><div class="o2-mid-in">${P.updateBanner(s)}${body}</div></div>
      ${bar ? `<div class="o2-actionbar">${bar}</div>` : ""}
      ${s.setup === "done" && !kept ? `<div class="o2-mid-foot">${P.composer(s)}</div>` : ""}
    </section>`;
  }

  const TABS = [["preview", "Preview", "eye"], ["checks", "Checks", "shield"], ["changes", "Changes", "file"]];
  const autoOpen = (s) => ["checking", "failed", "ready", "switching"].includes(s.phase);

  function right(s, sel) {
    const kept = s.kept.find((k) => k.id === sel);
    const live = !kept && WS.hasActive(s) && s.phase !== "kept";
    const open = s.width === "phone" || (s.ui.rightOpen ?? (autoOpen(s) && !kept));
    const tab = s.ui.tab || (["building", "checking", "failed", "switching"].includes(s.phase) ? "checks" : "preview");
    const readyDot = live && s.phase === "ready" ? P.dot("ok") : "";
    if (!open)
      return `<aside class="o2-right is-rail" aria-label="Change details (collapsed)">
        <button type="button" class="a-icon-btn" data-act="right-toggle" data-focus="right-toggle" aria-label="Open details pane">${icons.panelRight}</button>
        <span class="o2-rail-sep"></span>
        ${TABS.map(([id, label, ic]) => `<button type="button" class="a-icon-btn o2-ricon" data-act="tab" data-id="${id}" data-focus="tab-${id}" aria-label="${label}" title="${label}">${icons[ic]}${id === "preview" ? readyDot : ""}</button>`).join("")}
      </aside>`;
    const tabs = TABS.map(
      ([id, label, ic]) => `<button type="button" class="a-segtab" role="tab" aria-selected="${tab === id}" data-act="tab" data-id="${id}" data-focus="tab-${id}">${icons[ic]}${label}${id === "preview" ? readyDot : ""}</button>`,
    ).join("");
    let content = "";
    if (tab === "preview") {
      content =
        live && s.previewOpen && s.phase === "ready"
          ? P.preview(s)
          : kept
            ? `<p class="a-empty">This change is part of your ADE now. Try it in your own sessions.</p>`
            : live && s.phase === "ready"
              ? `<div class="a-card"><div class="a-setup"><span class="a-setup-icon">${icons.eye}</span><h2>Try it before you keep it</h2><p>Opens a second ADE on 127.0.0.1:3101 with test data, in the Browser.</p><button type="button" class="a-btn is-primary" data-act="try" data-focus="preview-try">${icons.eye}Try it</button></div></div>`
              : `<p class="a-empty">The preview opens here once the checks pass.</p>`;
    } else if (tab === "checks") {
      content = kept
        ? `<div class="a-checks">${SAMPLE.checks.map((c) => `<div class="a-check" data-s="pass"><span class="a-check-mark">${icons.circleCheck}</span><span class="a-check-name">${c.name}</span><span class="a-check-time">${c.time}</span></div>`).join("")}</div>`
        : live
          ? P.checks(s)
          : `<p class="a-empty">Checks appear here after the agent builds.</p>`;
    } else {
      const files = kept ? kept.files : live ? SAMPLE.files : [];
      content = `${files.length ? `<div class="a-files">${files.map((x) => `<div class="a-file">${icons.file}<code>${esc(x.path)}</code><span class="a-add">+${x.add}</span></div>`).join("")}</div>` : `<p class="a-empty">No files yet.</p>`}
        ${kept ? `<div class="a-card">${P.keptRow(s, kept)}</div>` : ""}
        <p class="a-hint">Files in the private copy only. The design files check keeps colors and layout untouched.</p>`;
    }
    return `<aside class="o2-right" aria-label="Change details">
      <div class="a-segtabs" role="tablist">${tabs}${s.width === "phone" ? "" : `<button type="button" class="a-icon-btn o2-collapse" data-act="right-toggle" data-focus="right-toggle" aria-label="Collapse details pane">${icons.panelRight}</button>`}</div>
      <div class="o2-pad" data-scroll="o2-right">${content}${P.stockHint()}</div>
    </aside>`;
  }

  WS.defineOption({
    id: 2,
    name: "Workbench",
    tradeoff: "The most power and visibility, with the preview, checks and files always in view, but the heaviest and most technical.",
    notes: [
      "The project shell, kept: a rail with search and All / Needs you / Working / Kept filters, the change's conversation in the middle, and a right pane like Activity, Diff, Browser.",
      "Rail groups are <b>In progress</b>, <b>Ready to try</b>, <b>Kept</b> and <b>Needs you</b>. A failed check or an update that can't carry over lands in Needs you.",
      "<b>Preview</b> shows the second ADE in browser chrome with the new <b>Copy log</b> button marked. <b>Checks</b> and <b>Changes</b> keep the evidence beside the conversation.",
      "The right pane starts as a slim icon rail, as in the live shell, and opens by itself once checks start. A teal dot on Preview means it is ready. Try it, Keep it and Undo sit above the composer so they stay reachable when the pane is collapsed.",
      "Weakness: it shows file names and paths, the most technical thing in the four, and it needs room. On a phone it collapses to three panes.",
    ],
    thumbUi: { tab: "preview" },
    css: `
      .opt-2 .o2 { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px minmax(0, 1fr) auto; }
      .opt-2 .o2-rail { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--paper); }
      .opt-2 .o2-rail-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 12px 8px 16px; }
      .opt-2 .o2-rail-head h2 { font-family: var(--font-display); font-size: 20px; font-weight: 500; }
      .opt-2 .o2-search { display: flex; align-items: center; gap: 8px; margin: 4px 8px 8px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--dim); }
      .opt-2 .o2-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 8px 0; font-size: 13px; }
      .opt-2 .o2-filters { display: flex; gap: 2px; margin: 0 8px 4px; padding: 3px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-muted); }
      .opt-2 .o2-pill { flex: 1; padding: 4px 6px; border-radius: 9px; font-size: 12px; color: var(--dim); white-space: nowrap; }
      .opt-2 .o2-pill[aria-pressed="true"] { background: var(--ink); color: var(--paper); font-weight: 600; }
      .opt-2 .o2-check { display: inline-flex; align-items: center; gap: 6px; }
      .opt-2 .o2-actionbar { padding: 12px 20px; border-top: 1px solid var(--line); }
      .opt-2 .o2-mid-in.is-start { padding-top: 24px; }
      .opt-2 .o2-right { width: 520px; }
      .opt-2 .o2-right.is-rail { width: 48px; align-items: center; padding: 10px 0; gap: 4px; background: var(--paper); }
      .opt-2 .o2-rail-sep { width: 24px; height: 1px; background: var(--line); margin: 4px 0; }
      .opt-2 .o2-ricon { position: relative; }
      .opt-2 .o2-ricon .a-dot { position: absolute; top: 4px; right: 4px; }
      .opt-2 .a-segtab .a-dot { margin-left: 2px; }
      .opt-2 .o2-collapse { margin-left: auto; align-self: center; }
      .opt-2 .o2-search svg.i { width: 14px; height: 14px; }
      .opt-2 .o2-groups { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px; }
      .opt-2 .o2-group-label { display: flex; justify-content: space-between; padding: 12px 8px 4px; font-size: 12px; font-weight: 500; color: var(--dim); }
      .opt-2 .o2-group-label span { font-family: var(--font-mono); font-size: 11px; font-weight: 400; }
      .opt-2 .o2-item { display: grid; gap: 2px; width: 100%; padding: 8px 10px; border-radius: 10px; text-align: left; border: 1px solid transparent; }
      .opt-2 .o2-item:hover { background: color-mix(in oklab, var(--ink) 3%, transparent); }
      .opt-2 .o2-item.is-selected { background: var(--surface-muted); border-color: var(--line); }
      .opt-2 .o2-item-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opt-2 .o2-item-sub { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--dim); }
      .opt-2 .o2-item-sub .a-pill { font-size: 11.5px; }
      .opt-2 .o2-rail-foot { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--dim); }
      .opt-2 .o2-mid { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
      .opt-2 .o2-mid-head { padding: 18px 20px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 6px; }
      .opt-2 .o2-mid-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .opt-2 .o2-mid-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; }
      .opt-2 .o2-mid-in { display: grid; gap: 12px; align-content: start; }
      .opt-2 .o2-mid-foot { padding: 12px 20px 16px; border-top: 1px solid var(--line); }
      .opt-2 .a-msg { font-size: 14px; }
      .opt-2 .o2-right { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); }
      .opt-2 .o2-right-actions { padding: 12px 16px; border-bottom: 1px solid var(--line); }
      .opt-2 .o2-pad { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: grid; gap: 12px; align-content: start; }
      .opt-2 .o2-pad:has(+ .o2-pad) { flex: none; overflow: visible; padding-bottom: 0; }
      .opt-2 .o2-phonebar { display: none; }
      .opt-2[data-width="phone"] .o2 { display: flex; flex-direction: column; }
      .opt-2[data-width="phone"] .o2-phonebar { display: flex; }
      .opt-2[data-width="phone"] .o2 > aside, .opt-2[data-width="phone"] .o2 > section { flex: 1; min-height: 0; border: 0; }
      .opt-2[data-width="phone"] .o2[data-pane="list"] > .o2-mid, .opt-2[data-width="phone"] .o2[data-pane="list"] > .o2-right,
      .opt-2[data-width="phone"] .o2[data-pane="chat"] > .o2-rail, .opt-2[data-width="phone"] .o2[data-pane="chat"] > .o2-right,
      .opt-2[data-width="phone"] .o2[data-pane="details"] > .o2-rail, .opt-2[data-width="phone"] .o2[data-pane="details"] > .o2-mid { display: none; }
      .opt-2[data-width="phone"] .o2-right { width: auto; }
      .opt-2[data-width="phone"] .o2-mid-head { padding: 14px 16px 10px; }
      .opt-2[data-width="phone"] .o2-mid-body { padding: 12px 16px; }
      .opt-2[data-width="phone"] .o2-mid-foot { padding: 10px 16px 14px; }
      .opt-2[data-width="phone"] .a-actions .a-btn { flex: 1; }
    `,
    input: { "rail-search": (el, ctx, ui) => ui({ q: el.value }) },
    act: {
      select: (el, ev, eng, ctx, ui) => ui({ sel: el.dataset.id, pane: "chat" }),
      tab: (el, ev, eng, ctx, ui) => ui({ tab: el.dataset.id, rightOpen: true }),
      "right-toggle": (el, ev, eng, ctx, ui) => {
        const s = ctx.getState();
        const kept = s.kept.some((k) => k.id === s.ui.sel);
        ui({ rightOpen: !(s.ui.rightOpen ?? (autoOpen(s) && !kept)) });
      },
      filter: (el, ev, eng, ctx, ui) => ui({ filter: el.dataset.id }),
      "show-removed": (el, ev, eng, ctx, ui) => ui({ showRemoved: !ctx.getState().ui.showRemoved }),
      "new-change": (el, ev, eng, ctx, ui) => {
        eng.newChange();
        ui({ sel: null, pane: "chat" });
      },
      pane: (el, ev, eng, ctx, ui) => ui({ pane: el.dataset.id }),
      try: (el, ev, eng, ctx, ui) => {
        eng.tryIt();
        ui({ tab: "preview", pane: "details", rightOpen: true });
      },
    },
    render(s) {
      const list = items(s);
      const sel = selection(s, list);
      const pane = s.ui.pane || "chat";
      const pb = (id, label) => `<button type="button" class="a-segtab" role="tab" aria-selected="${pane === id}" data-act="pane" data-id="${id}" data-focus="pane-${id}">${label}</button>`;
      return `${P.topbar(s)}
        <div class="a-segtabs o2-phonebar" role="tablist">${pb("list", "Changes")}${pb("chat", "Conversation")}${pb("details", "Details")}</div>
        <div class="o2" data-pane="${pane}">
          ${rail(s, list, sel)}
          ${middle(s, sel)}
          ${right(s, sel)}
        </div>
        ${P.notice(s)}`;
    },
  });
})();
