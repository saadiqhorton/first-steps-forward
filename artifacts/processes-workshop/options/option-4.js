/* Option 4 — Cards: each process is a glanceable card under its conversation,
 * with the last lines of output on its face. Details open in a sheet over the
 * page, so the cards keep their place. */
(function () {
  "use strict";

  const { icons, mock } = WS;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function peek(proc) {
    const lines = mock.outputOf(proc, "short").slice(-5);
    return `<div class="o4-peek" aria-hidden="true">${lines
      .map((l) => `<span>${esc(l) || " "}</span>`)
      .join("")}</div>`;
  }

  function card(proc, state) {
    const meta = mock.statusMeta(proc.status);
    const address = mock.addressOf(proc);
    return `<article class="o4-card ${proc.status === "failed" ? "is-failed" : ""}" data-id="${proc.id}">
      <button type="button" class="o4-card-hit" data-act="sheet" data-id="${proc.id}"
        data-focus="card-${proc.id}" aria-label="Open ${esc(proc.name)}">
        <span class="o4-card-top">
          <span class="m-dot" data-tone="${meta.tone}"></span>
          <span class="o4-card-name m-truncate">${esc(proc.name)}</span>
          <span class="o4-card-status" data-tone="${meta.tone}">${meta.label}</span>
        </span>
        <span class="o4-card-addr">
          ${address ? `<span class="m-mono m-truncate">${esc(address)}</span>` : `<span class="m-label-mono">No address</span>`}
        </span>
        ${peek(proc)}
        <span class="o4-card-foot">
          <span class="o4-card-when">${esc(proc.startedAt)}</span>
          <span class="o4-card-open">Details ${icons.chevronRight}</span>
        </span>
      </button>
      <div class="o4-card-actions">
        ${
          address
            ? `<button type="button" class="o4-mini" data-act="open" data-id="${proc.id}"
                data-focus="card-open-${proc.id}" ${proc.status === "running" ? "" : "disabled"}>${icons.external} Open</button>`
            : ""
        }
        <button type="button" class="o4-mini" data-act="stop" data-id="${proc.id}"
          data-focus="card-stop-${proc.id}" ${proc.status === "stopping" ? "disabled" : ""}>
          ${proc.status === "stopping" ? icons.loader : icons.square}
          ${proc.status === "stopping" ? "Stopping…" : proc.status === "failed" ? "Retry" : "Stop"}
        </button>
      </div>
    </article>`;
  }

  function sheet(state) {
    const proc = state.processes.find((p) => p.id === state.sheet);
    if (!proc) return "";
    const address = mock.addressOf(proc);
    const meta = mock.statusMeta(proc.status);
    const conversation = mock.conversations.find((c) => c.id === proc.conversationId);
    const lines = mock.outputOf(proc, state.outputLines);
    return `<div class="o4-scrim" data-act="close-sheet"></div>
      <aside class="o4-sheet" role="dialog" aria-modal="true" aria-label="${esc(proc.name)}">
        <div class="o4-sheet-head">
          <div class="o4-sheet-title">
            <span class="m-dot" data-tone="${meta.tone}"></span>
            <h2>${esc(proc.name)}</h2>
            <span class="o4-chip" data-tone="${meta.tone}">${meta.label}</span>
          </div>
          <button type="button" class="m-icon-btn" data-act="close-sheet" data-focus="sheet-close" aria-label="Close">${icons.x}</button>
        </div>
        <div class="o4-sheet-meta">
          <button type="button" class="o4-conv-link" data-act="select-conversation">${icons.message}${esc(conversation?.title)}</button>
          <span>·</span><span>${esc(proc.startedAt)}</span>
        </div>
        ${
          address
            ? `<div class="o4-sheet-address">
                <button type="button" class="o4-addr-copy" data-act="copy" data-id="${proc.id}" data-focus="sheet-copy"
                  title="Copy address"><span class="m-mono">${esc(address)}</span>${icons.copy}</button>
                <button type="button" class="m-btn-quiet o4-small" data-act="open" data-id="${proc.id}"
                  data-focus="sheet-open" ${proc.status === "running" ? "" : "disabled"}>Open in browser ${icons.external}</button>
              </div>`
            : `<p class="m-label-mono">This process serves no website.</p>`
        }
        ${
          proc.status === "unverified"
            ? `<div class="o4-check"><span>ADE can't confirm this is still running. Read the output, then mark it as good.</span>
                <button type="button" class="o4-link" data-act="mark-good" data-id="${proc.id}"
                  data-focus="sheet-good">Mark as good</button></div>`
            : ""
        }
        ${
          proc.status === "failed" && proc.stopError
            ? `<div class="o4-error">${icons.alert}<span>${esc(proc.stopError)}</span></div>`
            : ""
        }
        <dl class="o4-details">
          <div><dt>Command</dt><dd class="m-mono">${esc(proc.command)}</dd></div>
          <div><dt>Folder</dt><dd class="m-mono">${esc(proc.cwd && proc.cwd !== "." ? proc.cwd : "project root")}</dd></div>
          <div><dt>Source</dt><dd>${esc(proc.source)}</dd></div>
          <div><dt>Process</dt><dd class="m-mono">${proc.pid ? `pid ${proc.pid}` : "recorded by ADE"}</dd></div>
        </dl>
        <div class="o4-out-head">
          <span class="m-label-mono">${icons.terminal} Following log</span>
          <div class="o4-tools">
            <button type="button" class="o4-tool" data-act="wrap" data-focus="sheet-wrap"
              aria-pressed="${state.wrap}">${icons.wrap} Wrap</button>
            <button type="button" class="o4-tool" data-act="follow" data-focus="sheet-follow"
              aria-pressed="${state.follow}">${icons.arrowDown} Follow latest</button>
          </div>
        </div>
        <pre class="o4-console ${state.wrap ? "is-wrapped" : ""}" data-output tabindex="0"
          aria-label="Output of ${esc(proc.name)}">${lines.map((l, i) => `<span class="o4-line${i === lines.length - 1 ? " is-latest" : ""}">${esc(l) || " "}</span>`).join("")}</pre>
        <div class="o4-sheet-foot">
          <span>${lines.length} lines</span>
          <button type="button" class="m-btn-quiet o4-small o4-stop" data-act="stop" data-id="${proc.id}"
            data-focus="sheet-stop" ${proc.status === "stopping" ? "disabled" : ""}>
            ${proc.status === "stopping" ? icons.loader : icons.square}
            ${proc.status === "stopping" ? "Stopping…" : proc.status === "failed" ? "Retry stop" : "Stop"}
          </button>
        </div>
      </aside>`;
  }

  function shell(state) {
    const found = mock.groups(state.processes, state.query);
    const checkCount = mock.checks(state.processes);
    const content = !state.processes.length
      ? mock.emptyState()
      : !found.length
        ? `<div class="m-empty">No processes match “${esc(state.query)}”</div>`
        : found
            .map(
              ({ conversation, processes }) => `<section class="o4-group" aria-label="${esc(conversation.title)}">
                <div class="o4-group-head">
                  <span class="o4-group-title">${icons.message}${esc(conversation.title)}</span>
                  <span class="o4-group-meta">${esc(conversation.agent)} · ${esc(conversation.age)} · ${processes.length} running</span>
                </div>
                <div class="o4-grid">${processes.map((p) => card(p, state)).join("")}</div>
              </section>`,
            )
            .join("");
    return `${mock.chrome("processes", state.processes.length)}
      <div class="o4-head">
        <div class="o4-head-title"><h2>Processes</h2><span class="m-count">${state.processes.length}</span></div>
        <div class="o4-search">
          ${icons.search}
          <input type="search" data-act="search" data-focus="search" value="${esc(state.query)}"
            placeholder="Search processes…" aria-label="Search processes" />
        </div>
        ${
          checkCount
            ? `<div class="o4-checkbar"><b>${checkCount} to check</b>
                <button type="button" class="o4-link" data-act="mark-all" data-focus="mark-all">Mark all as good</button></div>`
            : ""
        }
        <button type="button" class="m-btn-quiet o4-small o4-stopall" data-act="stop-all" data-focus="stop-all">
          ${icons.square} Stop all
        </button>
      </div>
      <div class="m-scroll o4-content">${content}</div>
      ${sheet(state)}
      ${state.confirmStopAll ? mock.confirmDialog(state.processes) : ""}
      ${mock.notice(state.notice?.text, state.notice?.tone)}`;
  }

  WS.register({
    id: 4,
    name: "Cards",
    tradeoff:
      "Each process is a card with its last lines on its face; details open in a sheet. Easiest to scan, but a card cannot show much output and the sheet covers the list.",
    notes: [
      "Processes are grouped under their conversation as <b>cards</b>, two or three across, each with a status, address and its last five lines.",
      "Every card carries <b>Open</b> and <b>Stop</b> on its face; <b>Details</b> opens a sheet with the full output and process details.",
      "The sheet keeps the page behind it, so closing it returns you to the same cards and search.",
      "Needs-checking processes raise the same bar and <b>Mark all as good</b>; the empty state invites the agent to start the site.",
      "In the real code this is a card grid plus a sheet component; it reads well on a wide window and stacks to one column on a narrow one.",
    ],
    css: `
      .opt-4 .o4-head {
        display: flex; align-items: center; gap: 10px; flex: none;
        padding: 10px 16px; border-bottom: 1px solid var(--line);
      }
      .opt-4 .o4-head-title { display: flex; align-items: center; gap: 6px; }
      .opt-4 .o4-head-title h2 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500; }
      .opt-4 .o4-search {
        display: flex; align-items: center; gap: 6px; width: 270px; padding: 0 8px;
        border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--dim);
      }
      .opt-4 .o4-search svg.i { width: 12px; height: 12px; }
      .opt-4 .o4-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 6px 0; font-size: 12px; }
      .opt-4 .o4-checkbar {
        display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 7px;
        font-size: 11.5px; border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-4 .o4-link { color: var(--ink); font-size: 11.5px; }
      .opt-4 .o4-small { font-size: 11px; padding: 4px 9px; gap: 4px; }
      .opt-4 .o4-small svg.i { width: 11px; height: 11px; }
      .opt-4 .o4-stopall { margin-left: auto; }
      .opt-4 .o4-content { padding: 14px 16px 20px; }
      .opt-4 .o4-group + .o4-group { margin-top: 14px; }
      .opt-4 .o4-group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
      .opt-4 .o4-group-title {
        display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--dim);
      }
      .opt-4 .o4-group-title svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-group-meta { font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-4 .o4-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .opt-4 .o4-card {
        display: flex; flex-direction: column; min-width: 0;
        border: 1px solid var(--line); border-radius: 11px; background: var(--panel);
        overflow: hidden; transition: border-color 120ms ease;
      }
      .opt-4 .o4-card:hover { border-color: color-mix(in oklab, var(--amber) 55%, var(--line)); }
      .opt-4 .o4-card.is-failed { border-color: color-mix(in oklab, var(--danger) 40%, var(--line)); }
      .opt-4 .o4-card-hit { display: grid; gap: 6px; padding: 10px 11px 8px; text-align: left; min-width: 0; }
      .opt-4 .o4-card-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .opt-4 .o4-card-name { font-size: 13px; font-weight: 500; }
      .opt-4 .o4-card-status {
        margin-left: auto; flex: none; font-family: var(--font-mono); font-size: 11px; color: var(--dim);
      }
      .opt-4 .o4-card-status[data-tone="ok"] { color: var(--teal); }
      .opt-4 .o4-card-status[data-tone="warn"] { color: var(--amber-deep); }
      .opt-4 .o4-card-status[data-tone="bad"] { color: var(--danger); }
      .opt-4 .o4-card-addr { display: flex; min-width: 0; font-size: 11px; color: var(--dim); }
      .opt-4 .o4-peek {
        display: grid; gap: 1px; padding: 7px 8px; border-radius: 7px;
        background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11px; line-height: 1.5;
        overflow: hidden; max-height: 92px;
        mask-image: linear-gradient(to bottom, black 70%, transparent);
      }
      .opt-4 .o4-peek span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .opt-4 .o4-card-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums;
        color: var(--dim);
      }
      .opt-4 .o4-card-open { display: inline-flex; align-items: center; gap: 2px; color: var(--ink); }
      .opt-4 .o4-card-open svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-card-actions {
        display: flex; gap: 4px; align-items: center; padding: 6px 8px;
        border-top: 1px solid color-mix(in oklab, var(--line) 65%, transparent);
      }
      .opt-4 .o4-mini {
        display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px;
        font-size: 11.5px; color: var(--dim); border: 1px solid var(--line); background: var(--paper);
      }
      .opt-4 .o4-mini svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-mini:hover { color: var(--ink); border-color: var(--amber); }
      .opt-4 .o4-mini:disabled { opacity: 0.5; }
      .opt-4 .o4-scrim {
        position: absolute; inset: 0; z-index: 15; background: var(--scrim);
        animation: o4-fade 150ms ease-out;
      }
      @keyframes o4-fade { from { opacity: 0; } }
      .opt-4 .o4-sheet {
        position: absolute; z-index: 16; top: 0; right: 0; bottom: 0; width: 448px;
        display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
        background: var(--panel); border-left: 1px solid var(--line);
        box-shadow: var(--shadow-floating); animation: o4-slide 180ms ease-out;
      }
      @keyframes o4-slide { from { transform: translateX(24px); opacity: 0.4; } }
      .opt-4 .o4-sheet-head { display: flex; align-items: center; gap: 6px; }
      .opt-4 .o4-sheet-title { display: flex; align-items: center; gap: 7px; min-width: 0; }
      .opt-4 .o4-sheet-title h2 {
        margin: 0; font-family: var(--font-display); font-size: 17px; font-weight: 500;
      }
      .opt-4 .o4-sheet-head .m-icon-btn { margin-left: auto; }
      .opt-4 .o4-chip {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: var(--font-mono); font-size: 11px; color: var(--dim);
      }
      .opt-4 .o4-chip[data-tone="ok"] { color: var(--teal); }
      .opt-4 .o4-chip[data-tone="warn"] { color: var(--amber-deep); }
      .opt-4 .o4-chip[data-tone="bad"] { color: var(--danger); }
      .opt-4 .o4-sheet-meta {
        display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--dim);
      }
      .opt-4 .o4-conv-link { display: inline-flex; align-items: center; gap: 4px; color: var(--dim); font-size: 11px; }
      .opt-4 .o4-conv-link svg.i { width: 11px; height: 11px; }
      .opt-4 .o4-conv-link:hover { color: var(--ink); }
      .opt-4 .o4-sheet-address { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .opt-4 .o4-addr-copy {
        display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px;
        border: 1px solid var(--line); border-radius: 6px; background: var(--paper);
      }
      .opt-4 .o4-addr-copy svg.i { width: 10px; height: 10px; color: var(--dim); }
      .opt-4 .o4-check .o4-link { flex: none; white-space: nowrap; }
      .opt-4 .o4-check, .opt-4 .o4-error {
        display: flex; align-items: center; gap: 6px; justify-content: space-between;
        padding: 6px 8px; border-radius: 7px; font-size: 10.5px;
      }
      .opt-4 .o4-check {
        border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-4 .o4-error {
        border: 1px solid color-mix(in oklab, var(--danger) 35%, var(--line));
        background: color-mix(in oklab, var(--danger) 6%, transparent); color: var(--danger);
      }
      .opt-4 .o4-error svg.i { width: 11px; height: 11px; flex: none; }
      .opt-4 .o4-details {
        display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 2px 0;
      }
      .opt-4 .o4-details > div { display: flex; gap: 6px; min-width: 0; font-size: 12px; }
      .opt-4 .o4-details dt { flex: none; width: 56px; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-4 .o4-details dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opt-4 .o4-out-head { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
      .opt-4 .o4-out-head > .m-label-mono { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; letter-spacing: 0; }
      .opt-4 .o4-out-head svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-tools { margin-left: auto; display: flex; gap: 2px; }
      .opt-4 .o4-tool {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 8px;
        font-size: 11.5px; color: var(--dim); border: 1px solid transparent;
      }
      .opt-4 .o4-tool svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-tool[aria-pressed="true"] { border-color: var(--line); background: var(--paper); color: var(--ink); }
      .opt-4 .o4-console {
        flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 12px 16px;
        border-radius: 12px; background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6; letter-spacing: 0;
      }
      .opt-4 .o4-console.is-wrapped { white-space: pre-wrap; word-break: break-word; }
      .opt-4 .o4-console:not(.is-wrapped) { white-space: pre; }
      .opt-4 .o4-line { display: block; }
      .opt-4 .o4-line.is-latest { border-left: 2px solid var(--amber); margin-left: -8px; padding-left: 8px; }
      .opt-4 .o4-sheet-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        font-family: var(--font-mono); font-size: 11px; color: var(--dim);
      }
      .opt-4 .o4-stop svg.i { width: 14px; height: 14px; }
      .opt-4 .o4-stop:disabled { opacity: 0.6; }
      .opt-4 .o4-cu { padding: 14px; display: grid; gap: 8px; }
      .opt-4 .o4-cu-title { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0; color: var(--dim); }
      .opt-4 .o4-cu-card { width: 300px; }
    `,
    mount(root, ctx) {
      const timers = new Set();
      const later = (fn, ms) => {
        const t = setTimeout(() => {
          timers.delete(t);
          fn();
        }, ms);
        timers.add(t);
        return t;
      };
      let lastTop = 0;

      function stop(id) {
        const state = ctx.getState();
        const result = mock.stopProcess(state, id);
        if (!result) return;
        if (!result.removed) {
          ctx.setState({ notice: { text: `Couldn't stop ${result.proc.name}. Open it to read why.`, tone: "error" } });
          return;
        }
        ctx.setState({ notice: { text: `Stopping ${result.proc.name}…` } });
        later(() => {
          const now = ctx.getState();
          const remaining = now.processes.filter((p) => p.id !== id);
          ctx.setState({
            processes: remaining,
            selected: now.selected === id ? null : now.selected,
            sheet: now.sheet === id ? null : now.sheet,
            notice: { text: `${result.proc.name} stopped` },
          });
        }, 1200);
      }

      function stopAll() {
        const state = ctx.getState();
        if (!state.confirmStopAll) return ctx.setState({ confirmStopAll: true });
        const count = state.processes.length;
        for (const proc of state.processes) proc.status = "stopping";
        ctx.setState({ confirmStopAll: false, sheet: null });
        later(() => {
          ctx.setState({ processes: [], selected: null, notice: { text: `Stopped ${count} processes` } });
        }, 1300);
      }

      function onClick(event) {
        const el = event.target.closest("[data-act]");
        if (!el || !root.contains(el)) return;
        const act = el.dataset.act;
        const state = ctx.getState();
        if (act === "sheet" || act === "select") {
          ctx.setState({ selected: el.dataset.id, sheet: el.dataset.id });
          const proc = state.processes.find((p) => p.id === el.dataset.id);
          if (proc) ctx.report(`${proc.name} · ${mock.statusMeta(proc.status).label}`);
        } else if (act === "close-sheet") {
          ctx.setState({ sheet: null });
        } else if (act === "open") {
          const proc = state.processes.find((p) => p.id === el.dataset.id);
          ctx.setState({ notice: { text: `Opening ${proc ? mock.addressOf(proc) : ""} in the agent browser (mock).` } });
        } else if (act === "copy") {
          const proc = state.processes.find((p) => p.id === el.dataset.id);
          const address = proc && mock.addressOf(proc);
          if (address) {
            navigator.clipboard?.writeText(`http://${address}/`).catch(() => {});
            ctx.report(`Copied ${address}`);
            ctx.setState({ notice: { text: "Address copied" } });
          }
        } else if (act === "mark-good") {
          mock.markGood(state, el.dataset.id);
          ctx.setState({ notice: { text: "Marked as good" } });
        } else if (act === "mark-all") {
          const count = mock.markAllGood(state);
          ctx.setState({ notice: { text: `Marked ${count} ${count === 1 ? "process" : "processes"} as good.` } });
        } else if (act === "stop") stop(el.dataset.id);
        else if (act === "stop-all") stopAll();
        else if (act === "cancel-stop-all") ctx.setState({ confirmStopAll: false });
        else if (act === "confirm-stop-all") stopAll();
        else if (act === "wrap") ctx.setState({ wrap: !state.wrap });
        else if (act === "follow") ctx.setState({ follow: true });
        else if (act === "select-conversation") ctx.setState({ notice: { text: "Switching to the conversation (mock)." } });
      }

      function onInput(event) {
        if (!event.target.matches('[data-act="search"]')) return;
        ctx.patch({ query: event.target.value });
        render(root, ctx.getState());
      }

      function onKey(event) {
        if (event.key === "Escape" && ctx.getState().sheet) {
          ctx.setState({ sheet: null });
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        const hit = event.target.closest?.('[data-act="sheet"]');
        if (!hit) return;
        event.preventDefault();
        ctx.setState({ selected: hit.dataset.id, sheet: hit.dataset.id });
      }

      function onScroll(event) {
        const target = event.target;
        if (!target.matches?.("[data-output]")) return;
        lastTop = target.scrollTop;
        const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 12;
        if (!atBottom && ctx.getState().follow) {
          ctx.patch({ follow: false });
          render(root, ctx.getState());
        } else if (atBottom && !ctx.getState().follow) {
          ctx.patch({ follow: true });
          render(root, ctx.getState());
        }
      }

      function render(el, state) {
        const out = root.querySelector("[data-output]");
        if (out && !state.follow) lastTop = out.scrollTop;
        WS.renderKeepFocus(el, shell(state));
        const next = el.querySelector("[data-output]");
        if (next) next.scrollTop = state.follow ? next.scrollHeight : lastTop;
      }

      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("keydown", onKey);
      root.addEventListener("scroll", onScroll, true);

      return {
        update(state) {
          render(root, state);
          ctx.report(
            state.processes.length
              ? `${state.processes.length} cards · ${mock.checks(state.processes)} to check${state.sheet ? " · sheet open" : ""}`
              : "Nothing running",
          );
        },
        destroy() {
          for (const t of timers) clearTimeout(t);
          root.removeEventListener("click", onClick);
          root.removeEventListener("input", onInput);
          root.removeEventListener("keydown", onKey);
          root.removeEventListener("scroll", onScroll, true);
        },
      };
    },
    closeups: [
      {
        label: "One card",
        mount(root) {
          const proc = mock.scenarioProcesses("mixed")[0];
          root.innerHTML = `<div class="o4-cu">
            <div class="o4-cu-title">Card</div>
            <div class="o4-cu-card">
              <article class="o4-card">
                <button type="button" class="o4-card-hit">
                  <span class="o4-card-top">
                    <span class="m-dot" data-tone="ok"></span>
                    <span class="o4-card-name m-truncate">${proc.name}</span>
                    <span class="o4-card-status" data-tone="ok">Running</span>
                  </span>
                  <span class="o4-card-addr"><span class="m-mono">127.0.0.1:5173</span></span>
                  ${peek(proc)}
                  <span class="o4-card-foot"><span class="o4-card-when">${proc.startedAt}</span>
                    <span class="o4-card-open">Details ${icons.chevronRight}</span></span>
                </button>
                <div class="o4-card-actions">
                  <span class="o4-mini">${icons.external} Open</span>
                  <span class="o4-mini">${icons.square} Stop</span>
                </div>
              </article>
            </div>
          </div>`;
          return { update() {} };
        },
      },
      {
        label: "Sheet header",
        mount(root) {
          root.innerHTML = `<div class="o4-cu">
            <div class="o4-cu-title">Sheet</div>
            <div class="o4-sheet" style="position:static;width:auto;height:auto;box-shadow:none;border:1px solid var(--line);border-radius:10px">
              <div class="o4-sheet-head">
                <div class="o4-sheet-title"><span class="m-dot" data-tone="ok"></span>
                  <h2>Development server</h2><span class="o4-chip" data-tone="ok">Running</span></div>
                <span class="m-icon-btn">${icons.x}</span>
              </div>
              <div class="o4-sheet-address">
                <span class="o4-addr-copy"><span class="m-mono">127.0.0.1:5173</span>${icons.copy}</span>
                <span class="m-btn-quiet o4-small">Open in browser ${icons.external}</span>
              </div>
            </div>
          </div>`;
          return { update() {} };
        },
      },
    ],
  });
})();
