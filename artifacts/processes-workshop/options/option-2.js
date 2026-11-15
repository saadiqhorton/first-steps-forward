/* Option 2 — Rail: Processes becomes a tab in the right pane, beside Activity,
 * Diff, Browser and Terminal. Rows expand in place to show their output, so you
 * never leave the conversation. */
(function () {
  "use strict";

  const { icons, mock } = WS;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function expanded(proc, state) {
    const address = mock.addressOf(proc);
    const meta = mock.statusMeta(proc.status);
    const lines = mock.outputOf(proc, state.outputLines);
    return `<div class="o2-exp">
      <div class="o2-exp-top">
        ${
          address
            ? `<button type="button" class="o2-address" data-act="copy" data-id="${proc.id}" data-focus="copy-${proc.id}"
                title="Copy address"><span class="m-mono">${esc(address)}</span>${icons.copy}</button>`
            : `<span class="m-label-mono">No address; it serves no website.</span>`
        }
        <div class="o2-exp-actions">
          ${
            address
              ? `<button type="button" class="m-btn-quiet o2-small" data-act="open" data-id="${proc.id}"
                  data-focus="open-${proc.id}" ${proc.status === "running" ? "" : "disabled"}>${icons.globe} Open</button>`
              : ""
          }
          <button type="button" class="m-btn-quiet o2-small o2-stop" data-act="stop" data-id="${proc.id}"
            data-focus="stop-${proc.id}" ${proc.status === "stopping" ? "disabled" : ""}>
            ${proc.status === "stopping" ? icons.loader : icons.square}
            ${proc.status === "stopping" ? "Stopping…" : proc.status === "failed" ? "Retry stop" : "Stop"}
          </button>
        </div>
      </div>
      ${
        proc.status === "unverified"
          ? `<div class="o2-check"><span>ADE can't confirm this is still running</span>
              <button type="button" class="o2-link" data-act="mark-good" data-id="${proc.id}"
                data-focus="good-${proc.id}">Mark as good</button></div>`
          : ""
      }
      ${
        proc.status === "failed" && proc.stopError
          ? `<div class="o2-error">${icons.alert}<span>${esc(proc.stopError)}</span></div>`
          : ""
      }
      <div class="o2-output-bar">
        <span class="o2-output-label">${icons.terminal} ${state.follow ? "Following log" : "Scrolled back"}</span>
        <div class="o2-output-tools">
          ${state.follow ? "" : `<button type="button" class="o2-tool is-follow" data-act="follow" data-focus="follow-${proc.id}">${icons.arrowDown} Follow latest</button>`}
          <button type="button" class="o2-tool ${state.wrap ? "is-on" : ""}" data-act="wrap" data-focus="wrap-${proc.id}"
            aria-pressed="${state.wrap}">${icons.wrap} Wrap lines</button>
        </div>
      </div>
      <pre class="o2-console ${state.wrap ? "is-wrapped" : ""}" data-output tabindex="0"
        aria-label="Output of ${esc(proc.name)}">${lines.map((l, i) => `<span class="o2-line${i === lines.length - 1 ? " is-latest" : ""}">${esc(l) || " "}</span>`).join("")}</pre>
      <div class="o2-exp-foot">
        <span>${lines.length} lines · ${esc(proc.command)}</span>
        <span class="o2-exp-state">${state.wrap ? "Wrapped" : "Unwrapped"}</span>
      </div>
    </div>`;
  }

  function pane(state) {
    const checkCount = mock.checks(state.processes);
    const found = mock.groups(state.processes, state.query);
    const list = !state.processes.length
      ? mock.emptyState()
      : !found.length
        ? `<div class="m-empty">No processes match “${esc(state.query)}”</div>`
        : found
            .map(
              ({ conversation, processes }) => `<section class="o2-group">
                ${mock.conversationHead(conversation)}
                ${processes
                  .map(
                    (p) => `<div class="o2-item ${p.id === state.selected ? "is-open" : ""}">
                      ${mock.row(p, { compact: true, selected: p.id === state.selected })}
                      ${p.id === state.selected ? expanded(p, state) : ""}
                    </div>`,
                  )
                  .join("")}
              </section>`,
            )
            .join("");

    return `<aside class="o2-pane" aria-label="Processes">
      <div class="o2-tabs" role="tablist" aria-label="Right pane">
        <span class="o2-tab" role="tab" aria-selected="false">Activity</span>
        <span class="o2-tab" role="tab" aria-selected="false">Diff</span>
        <span class="o2-tab" role="tab" aria-selected="false">Browser</span>
        <span class="o2-tab" role="tab" aria-selected="false">Terminal</span>
        <span class="o2-tab" role="tab" aria-selected="true">Processes <span class="m-count">${state.processes.length}</span></span>
        <button type="button" class="m-icon-btn o2-collapse" aria-label="Collapse right panel">${icons.panelRight}</button>
      </div>
      <div class="o2-head">
        <h2>Processes</h2>
        <button type="button" class="m-icon-btn" data-act="stop-all" data-focus="stop-all" aria-label="Stop all processes">${icons.more}</button>
      </div>
      <div class="o2-search">
        ${icons.search}
        <input type="search" data-act="search" data-focus="search" value="${esc(state.query)}"
          placeholder="Search processes…" aria-label="Search processes" />
      </div>
      ${
        checkCount
          ? `<div class="o2-checks"><span><b>${checkCount} to check</b></span>
              <button type="button" class="o2-link" data-act="mark-all" data-focus="mark-all">Mark all as good</button></div>`
          : ""
      }
      <div class="m-scroll o2-scroll">${list}</div>
      <div class="o2-foot">
        <span>${icons.terminal} ${state.processes.length} in this project</span>
        <button type="button" class="o2-link" data-act="stop-all" data-focus="foot-stop-all">Stop all</button>
      </div>
    </aside>`;
  }

  function shell(state) {
    return `${mock.chrome("conversations", state.processes.length, true)}
      <div class="o2-body">
        <nav class="o2-convlist" aria-label="Conversations">
          <div class="o2-convhead"><h2>Conversations</h2><span class="o2-plus">+</span></div>
          <div class="o2-convsearch">Search conversations</div>
          <div class="o2-convrow is-active"><span class="o2-convdot"></span><span class="m-truncate">Add a booking flow</span></div>
          <div class="o2-convrow"><span class="o2-convdot is-dim"></span><span class="m-truncate">Fix checkout totals</span></div>
        </nav>
        <main class="o2-conv">${mock.conversationBody(state)}</main>
        ${pane(state)}
      </div>
      ${state.confirmStopAll ? mock.confirmDialog(state.processes) : ""}
      ${mock.notice(state.notice?.text, state.notice?.tone)}`;
  }

  WS.register({
    id: 2,
    name: "Rail",
    chosen: true,
    tradeoff:
      "A right-pane tab that expands rows in place, so you keep the conversation and its preview. Dense and quick, but long output gets a short window.",
    notes: [
      "Processes is a <b>right-pane tab</b> for agent servers and watchers; the conversation stays put.",
      "In the ADE checkout only, a <b>Processes</b> project tab sits beside Skills for ADE itself. Other projects do not show it.",
      "The expanded row has <b>Follow latest</b>: output follows the newest line until you scroll up, then the button brings it back.",
      "A <b>Processes project tab</b> beside Skills opens ADE itself in every project, read-only. The right-pane tab keeps agent processes.",
      "A row expands where it sits: address, Open, Stop, then its output. One process stays open at a time, so the list keeps its shape.",
      "The conversation keeps the most room, which suits “my server just went down” moments without losing your place.",
      "Output wrap, follow, Mark as good and Stop all live in the same rail, not a separate page.",
      "Under the agent's reply, a command chip runs the process when it has exited and an address chip opens the site. Both are live.",
      "In the real code this adds a <b>Processes</b> right-pane tab and a compact list component; no new project route or section tab.",
    ],
    css: `
      .opt-2 .o2-body { display: flex; flex: 1; min-height: 0; }
      .opt-2 .o2-convlist {
        width: 250px; flex: none; display: grid; align-content: start; gap: 2px;
        border-right: 1px solid var(--line); padding: 8px; background: var(--paper);
      }
      .opt-2 .o2-convhead { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px 8px; }
      .opt-2 .o2-convhead h2 { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 500; }
      .opt-2 .o2-plus { color: var(--dim); font-size: 16px; }
      .opt-2 .o2-convsearch {
        margin: 0 4px 8px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px;
        background: var(--panel); color: var(--dim); font-size: 12px;
      }
      .opt-2 .o2-convrow {
        display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 8px;
        font-size: 12.5px; color: var(--dim);
      }
      .opt-2 .o2-convrow.is-active { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-2 .o2-convdot { width: 6px; height: 6px; border-radius: 999px; background: var(--amber); flex: none; }
      .opt-2 .o2-convdot.is-dim { background: var(--teal); opacity: 0.55; }
      .opt-2 .o2-conv { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
      .opt-2 .o2-pane {
        width: 412px; flex: none; display: flex; flex-direction: column; min-height: 0;
        border-left: 1px solid var(--line); background: var(--panel);
      }
      .opt-2 .o2-tabs {
        display: flex; align-items: center; gap: 2px; height: 36px; flex: none;
        padding: 0 6px; border-bottom: 1px solid var(--line); overflow: hidden;
      }
      .opt-2 .o2-tab {
        display: inline-flex; align-items: center; flex: none; padding: 4px 7px;
        border-radius: 6px; font-size: 11.5px; color: var(--dim); white-space: nowrap;
      }
      .opt-2 .o2-tab[aria-selected="true"] { color: var(--ink); background: color-mix(in oklab, var(--ink) 6%, transparent); font-weight: 500; }
      .opt-2 .o2-collapse { margin-left: auto; width: 24px; height: 24px; }
      .opt-2 .o2-collapse svg.i { width: 13px; height: 13px; }
      .opt-2 .o2-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px 4px;
      }
      .opt-2 .o2-head h2 { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 500; }
      .opt-2 .o2-search {
        display: flex; align-items: center; gap: 6px; margin: 4px 12px 0; padding: 0 8px;
        border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--dim);
      }
      .opt-2 .o2-search svg.i { width: 12px; height: 12px; }
      .opt-2 .o2-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 6px 0; font-size: 12px; }
      .opt-2 .o2-checks {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        margin: 8px 12px 0; padding: 6px 8px; border-radius: 7px; font-size: 11.5px;
        border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-2 .o2-link {
        font-size: 11.5px; color: var(--dim); padding: 2px 4px; border-radius: 4px; flex: none;
      }
      .opt-2 .o2-link:hover { color: var(--ink); }
      .opt-2 .o2-checks .o2-link { color: var(--ink); }
      .opt-2 .o2-scroll { padding: 4px 8px 8px; }
      .opt-2 .o2-group + .o2-group { margin-top: 2px; }
      .opt-2 .o2-item + .o2-item { border-top: 1px solid color-mix(in oklab, var(--line) 55%, transparent); }
      .opt-2 .o2-item.is-open { background: color-mix(in oklab, var(--ink) 4%, transparent); border-radius: 9px; }
      .opt-2 .o2-exp {
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px;
        padding: 0 10px 8px 23px; min-width: 0;
      }
      .opt-2 .o2-exp-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
      .opt-2 .o2-exp-top > * { min-width: 0; }
      .opt-2 .o2-address {
        display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
        padding: 2px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel);
      }
      .opt-2 .o2-address .m-mono { font-size: 11px; }
      .opt-2 .o2-address svg.i { width: 14px; height: 14px; color: var(--dim); }
      .opt-2 .o2-exp-actions { margin-left: auto; display: flex; gap: 4px; }
      .opt-2 .o2-small { font-size: 11.5px; padding: 4px 8px; gap: 6px; }
      .opt-2 .o2-small svg.i { width: 14px; height: 14px; }
      .opt-2 .o2-stop:disabled { opacity: 0.6; }
      .opt-2 .o2-check {
        display: flex; align-items: center; gap: 6px; justify-content: space-between;
        padding: 4px 8px; border-radius: 6px; font-size: 11.5px;
        border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-2 .o2-error {
        display: flex; align-items: flex-start; gap: 6px; padding: 4px 8px; border-radius: 6px;
        font-size: 11.5px; line-height: 1.45; color: var(--danger);
        border: 1px solid color-mix(in oklab, var(--danger) 35%, var(--line));
        background: color-mix(in oklab, var(--danger) 6%, transparent);
      }
      .opt-2 .o2-error svg.i { width: 11px; height: 11px; margin-top: 1px; }
      .opt-2 .o2-output-bar {
        display: flex; align-items: center; gap: 8px;
      }
      .opt-2 .o2-output-label {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: var(--font-mono); font-size: 11px; color: var(--dim);
      }
      .opt-2 .o2-output-tools { margin-left: auto; display: flex; align-items: center; gap: 2px; }
      .opt-2 .o2-tool {
        display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px;
        border-radius: 6px; font-size: 10.5px; color: var(--dim); border: 1px solid transparent;
      }
      .opt-2 .o2-tool svg.i { width: 12px; height: 12px; }
      .opt-2 .o2-tool.is-on { border-color: var(--line); background: var(--paper); color: var(--ink); }
      .opt-2 .o2-tool.is-follow { color: var(--amber-deep); border-color: color-mix(in oklab, var(--amber) 50%, var(--line)); background: color-mix(in oklab, var(--amber) 8%, transparent); }
      .opt-2 .o2-exp-state { color: var(--dim); }
      .opt-2 .o2-console {
        height: 152px; overflow: auto; margin: 0; padding: 12px 14px;
        border-radius: 8px; background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11px; line-height: 1.55; letter-spacing: 0;
      }
      .opt-2 .o2-console.is-wrapped { white-space: pre-wrap; word-break: break-word; }
      .opt-2 .o2-console:not(.is-wrapped) { white-space: pre; }
      .opt-2 .o2-line { display: block; }
      .opt-2 .o2-line.is-latest { border-left: 2px solid var(--amber); margin-left: -8px; padding-left: 8px; }
      .opt-2 .o2-exp-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding-top: 4px; font-family: var(--font-mono); font-size: 11px;
        font-variant-numeric: tabular-nums; color: var(--dim);
      }
      .opt-2 .o2-exp-foot > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opt-2 .o2-exp-foot .o2-link { display: inline-flex; align-items: center; gap: 4px; }
      .opt-2 .o2-exp-foot svg.i { width: 14px; height: 14px; }
      .opt-2 .o2-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        flex: none; padding: 8px 12px; border-top: 1px solid var(--line);
        background: var(--paper); font-family: var(--font-mono); font-size: 11px; color: var(--dim);
      }
      .opt-2 .o2-foot > span { display: inline-flex; align-items: center; gap: 4px; }
      .opt-2 .o2-foot svg.i { width: 14px; height: 14px; }
      .opt-2 .o2-cu { padding: 12px; }
      .opt-2 .o2-cu-row { border: 1px solid var(--line); border-radius: 10px; padding: 4px; background: var(--panel); }
      .opt-2 .o2-cu-actions { display: flex; align-items: center; gap: 6px; padding: 10px 4px 2px; }
      .opt-2 .o2-cu-chips { display: grid; gap: 10px; padding: 16px; }
      .opt-2 .o2-cu-chips .m-label-mono { font-size: 11.5px; line-height: 1.5; }
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
            notice: { text: `${result.proc.name} stopped` },
          });
        }, 1200);
      }

      function stopAll() {
        const state = ctx.getState();
        if (!state.confirmStopAll) return ctx.setState({ confirmStopAll: true });
        const count = state.processes.length;
        for (const proc of state.processes) proc.status = "stopping";
        ctx.setState({ confirmStopAll: false });
        later(() => {
          ctx.setState({ processes: [], selected: null, notice: { text: `Stopped ${count} processes` } });
        }, 1300);
      }

      function onClick(event) {
        const el = event.target.closest("[data-act]");
        if (!el || !root.contains(el)) return;
        const act = el.dataset.act;
        const state = ctx.getState();
        if (act === "select") {
          const id = el.dataset.id;
          ctx.setState({ selected: state.selected === id ? null : id });
          const proc = state.processes.find((p) => p.id === id);
          if (proc) ctx.report(`${proc.name} · ${mock.statusMeta(proc.status).label}`);
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
        } else if (act === "run-inline") {
          const proc = state.processes.find((item) => item.id === "p1");
          if (!proc) return;
          if (proc.status === "running") {
            ctx.setState({ notice: { text: "npm run dev is already running" } });
            return;
          }
          proc.status = "running";
          proc.port = 5173;
          proc.startedAt = "just now";
          ctx.setState({ selected: "p1", notice: { text: "Running npm run dev from the conversation" } });
        } else if (act === "open-inline") {
          ctx.setState({ notice: { text: "Opening 127.0.0.1:5173 in the browser (mock)" } });
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
      }

      function onInput(event) {
        if (!event.target.matches('[data-act="search"]')) return;
        ctx.patch({ query: event.target.value });
        render(root, ctx.getState());
      }

      function onScroll(event) {
        const target = event.target;
        if (!target.matches?.("[data-output]")) return;
        const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 12;
        if (!atBottom && ctx.getState().follow) {
          ctx.patch({ follow: false });
          render(root, ctx.getState());
        }
      }

      function render(el, state) {
        WS.renderKeepFocus(el, shell(state));
        const out = el.querySelector("[data-output]");
        if (out && state.follow) out.scrollTop = out.scrollHeight;
      }

      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("scroll", onScroll, true);

      return {
        update(state) {
          render(root, state);
          ctx.report(
            state.processes.length
              ? `${state.selected ? "1 expanded" : "All collapsed"} · ${mock.checks(state.processes)} to check`
              : "Nothing running",
          );
        },
        destroy() {
          for (const t of timers) clearTimeout(t);
          root.removeEventListener("click", onClick);
          root.removeEventListener("input", onInput);
          root.removeEventListener("scroll", onScroll, true);
        },
      };
    },
    closeups: [
      {
        label: "A collapsed row and an expanded one",
        mount(root) {
          const [p1, p2] = mock.scenarioProcesses("mixed");
          root.innerHTML = `<div class="o2-cu">
            <div class="o2-cu-row">${mock.row(p2, { compact: true })}</div>
            <div class="o2-cu-row">${mock.row(p1, { compact: true, selected: true })}
              <div class="o2-exp" style="padding-top:6px">
                <div class="o2-exp-top">
                  <span class="o2-address"><span class="m-mono">127.0.0.1:5173</span>${icons.copy}</span>
                  <div class="o2-exp-actions">
                    <span class="m-btn-quiet o2-small">${icons.globe} Open</span>
                    <span class="m-btn-quiet o2-small">${icons.square} Stop</span>
                  </div>
                </div>
              </div>
            </div>
          </div>`;
          return { update() {} };
        },
      },
      {
        label: "Process chips in a conversation",
        mount(root) {
          root.innerHTML = `<div class="o2-cu o2-cu-chips">
            <div class="m-msg-agent">
              <p>I added the flow and started the dev server so you can try it.</p>
              <div class="m-msg-actions">
                <button type="button" class="m-proc-chip"><span class="m-dot" data-tone="ok"></span>${icons.terminal}<span>npm run dev</span></button>
                <button type="button" class="m-proc-chip is-link">${icons.globe}<span>127.0.0.1:5173</span></button>
              </div>
            </div>
            <p class="m-label-mono">The command runs it again after it exits; the address opens the site</p>
          </div>`;
          return { update() {} };
        },
      },
      {
        label: "Right-pane tabs, close up",
        mount(root) {
          root.innerHTML = `<div class="o2-cu">
            <div class="o2-tabs">
              <span class="o2-tab">Activity</span><span class="o2-tab">Diff</span>
              <span class="o2-tab">Browser</span><span class="o2-tab">Terminal</span>
              <span class="o2-tab" aria-selected="true">Processes <span class="m-count">3</span></span>
            </div>
            <p class="m-label-mono" style="padding:12px 6px">The count sits on the tab, and the conversation never leaves.</p>
          </div>`;
          return { update() {} };
        },
      },
    ],
  });
})();
