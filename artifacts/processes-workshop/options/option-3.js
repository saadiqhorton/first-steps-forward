/* Option 3 — Console: one full-width table of processes with the output docked
 * below it, like a build console. Selecting a row loads it into the dock; the
 * page never pushes the log off screen. */
(function () {
  "use strict";

  const { icons, mock } = WS;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function tableBody(state) {
    if (!state.processes.length)
      return `<tr><td colspan="5">${mock.emptyState()}</td></tr>`;
    const found = mock.groups(state.processes, state.query);
    if (!found.length)
      return `<tr><td colspan="5"><div class="m-empty">No processes match “${esc(state.query)}”</div></td></tr>`;
    return found
      .map(
        ({ conversation, processes }) => `<tbody class="o3-group">
          <tr class="o3-grouprow"><td colspan="5">
            <span class="o3-group-title">${icons.message}${esc(conversation.title)}</span>
            <span class="o3-group-meta">${esc(conversation.agent)} · ${esc(conversation.age)}</span>
          </td></tr>
          ${processes
            .map((p) => {
              const meta = mock.statusMeta(p.status);
              const address = mock.addressOf(p);
              return `<tr class="o3-row ${p.id === state.selected ? "is-selected" : ""}" data-act="select" data-id="${p.id}"
                  data-focus="row-${p.id}" tabindex="0" aria-selected="${p.id === state.selected}">
                <td class="o3-status"><span class="m-dot" data-tone="${meta.tone}"></span>
                  <span class="m-status-text" data-tone="${meta.tone}">${meta.label}</span></td>
                <td class="o3-name"><span class="o3-name-text m-truncate">${esc(p.name)}</span>
                  <span class="o3-cmd m-truncate">${esc(p.command)}</span></td>
                <td class="o3-address">${
                  address
                    ? `<button type="button" class="o3-addr" data-act="open" data-id="${p.id}"
                        data-focus="open-${p.id}" ${p.status === "running" ? "" : "disabled"}>
                        <span class="m-mono">${esc(address)}</span>${icons.external}</button>`
                    : `<span class="o3-dash">—</span>`
                }</td>
                <td class="o3-start">${esc(p.startedAt)}</td>
                <td class="o3-act">
                  <button type="button" class="o3-stop" data-act="stop" data-id="${p.id}"
                    data-focus="stop-${p.id}" aria-label="Stop ${esc(p.name)}"
                    ${p.status === "stopping" ? "disabled" : ""}>
                    ${p.status === "stopping" ? icons.loader : icons.square}
                  </button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>`,
      )
      .join("");
  }

  function dock(state) {
    const proc = state.processes.find((p) => p.id === state.selected);
    if (!proc) {
      return `<div class="o3-dock is-empty">
        <div class="o3-dock-empty">${icons.terminal}<span>Select a process to read its output.</span></div>
      </div>`;
    }
    const address = mock.addressOf(proc);
    const meta = mock.statusMeta(proc.status);
    const lines = mock.outputOf(proc, state.outputLines);
    return `<div class="o3-dock">
      <div class="o3-dock-head">
        <span class="o3-dock-dot m-dot" data-tone="${meta.tone}"></span>
        <span class="o3-dock-name">${esc(proc.name)}</span>
        <span class="m-status-text" data-tone="${meta.tone}">${meta.label}</span>
        ${
          address
            ? `<button type="button" class="o3-addr" data-act="copy" data-id="${proc.id}"
                data-focus="dock-copy" title="Copy address"><span class="m-mono">${esc(address)}</span>${icons.copy}</button>`
            : ""
        }
        <div class="o3-dock-actions">
          ${
            address
              ? `<button type="button" class="m-btn-quiet o3-small" data-act="open" data-id="${proc.id}"
                  data-focus="dock-open" ${proc.status === "running" ? "" : "disabled"}>Open in browser ${icons.external}</button>`
              : ""
          }
          <button type="button" class="m-btn-quiet o3-small o3-stopbtn" data-act="stop" data-id="${proc.id}"
            data-focus="dock-stop" ${proc.status === "stopping" ? "disabled" : ""}>
            ${proc.status === "stopping" ? icons.loader : icons.square}
            ${proc.status === "stopping" ? "Stopping…" : proc.status === "failed" ? "Retry stop" : "Stop"}
          </button>
        </div>
      </div>
      ${
        proc.status === "failed" && proc.stopError
          ? `<div class="o3-error">${icons.alert}<span>${esc(proc.stopError)}</span></div>`
          : proc.status === "unverified"
            ? `<div class="o3-check">ADE can't confirm this is still running. Read the output, then
                <button type="button" class="o3-link" data-act="mark-good" data-id="${proc.id}"
                  data-focus="dock-good">mark it as good</button>.</div>`
            : ""
      }
      <div class="o3-dock-bar">
        <span class="m-label-mono">${icons.terminal} ${state.follow ? "Following log" : "Scrolled back"}</span>
        <div class="o3-tools">
          ${state.follow ? "" : `<button type="button" class="o3-tool is-follow" data-act="follow" data-focus="dock-follow">${icons.arrowDown} Follow latest</button>`}
          <button type="button" class="o3-tool ${state.wrap ? "is-on" : ""}" data-act="wrap" data-focus="dock-wrap"
            aria-pressed="${state.wrap}">${icons.wrap} Wrap lines</button>
        </div>
      </div>
      <pre class="o3-console ${state.wrap ? "is-wrapped" : ""}" data-output tabindex="0"
        aria-label="Output of ${esc(proc.name)}">${lines.map((l, i) => `<span class="o3-line${i === lines.length - 1 ? " is-latest" : ""}">${esc(l) || " "}</span>`).join("")}</pre>
      <div class="o3-dock-foot">
        <span>${lines.length} lines</span>
        <span>${esc(proc.source)} · ${esc(proc.startedAt)}</span>
      </div>
    </div>`;
  }

  function shell(state) {
    const checkCount = mock.checks(state.processes);
    return `${mock.chrome("processes", state.processes.length)}
      <div class="o3-head">
        <div class="o3-head-title"><h2>Processes</h2><span class="m-count">${state.processes.length}</span></div>
        <div class="o3-search">
          ${icons.search}
          <input type="search" data-act="search" data-focus="search" value="${esc(state.query)}"
            placeholder="Search processes…" aria-label="Search processes" />
        </div>
        ${
          checkCount
            ? `<div class="o3-checkbar"><b>${checkCount} to check</b>
                <button type="button" class="o3-link" data-act="mark-all" data-focus="mark-all">Mark all as good</button></div>`
            : ""
        }
        <button type="button" class="m-btn-quiet o3-small o3-stopall" data-act="stop-all" data-focus="stop-all">
          ${icons.square} Stop all
        </button>
      </div>
      <div class="o3-tablewrap m-scroll">
        <table class="o3-table" aria-label="Processes">
          <thead><tr>
            <th scope="col">Status</th>
            <th scope="col">Process</th>
            <th scope="col">Address</th>
            <th scope="col">Started</th>
            <th scope="col"><span class="o3-sr">Actions</span></th>
          </tr></thead>
          ${tableBody(state)}
        </table>
      </div>
      ${dock(state)}
      ${state.confirmStopAll ? mock.confirmDialog(state.processes) : ""}
      ${mock.notice(state.notice?.text, state.notice?.tone)}`;
  }

  WS.register({
    id: 3,
    name: "Console",
    tradeoff:
      "A table of every process with the log docked below. The best read for long output; the worst at a glance for which server is where when the list is short.",
    notes: [
      "One page, two bands: the table holds every process, grouped by conversation; the dock holds the selected one's output and actions.",
      "Columns are scan-friendly — status, name and command, address, started — and the address itself opens the site.",
      "The dock keeps <b>Wrap lines</b>, <b>Follow latest</b>, the line count and <b>Stop</b> in one bar, so the log gets real height.",
      "The reminder for processes that need checking is a bar in the header, with <b>Mark all as good</b> beside it.",
      "In the real code this replaces the list/detail split with a table and a docked panel; it needs a <code>processes</code> route and a table component.",
    ],
    css: `
      .opt-3 .o3-head {
        display: flex; align-items: center; gap: 10px; flex: none;
        padding: 10px 16px; border-bottom: 1px solid var(--line);
      }
      .opt-3 .o3-head-title { display: flex; align-items: center; gap: 6px; }
      .opt-3 .o3-head-title h2 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500; }
      .opt-3 .o3-search {
        display: flex; align-items: center; gap: 6px; width: 260px; padding: 0 8px;
        border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--dim);
      }
      .opt-3 .o3-search svg.i { width: 12px; height: 12px; }
      .opt-3 .o3-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; padding: 6px 0; font-size: 12px; }
      .opt-3 .o3-checkbar {
        display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 7px;
        font-size: 11.5px; border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-3 .o3-link { color: var(--ink); font-size: 11.5px; }
      .opt-3 .o3-small { font-size: 11px; padding: 4px 9px; gap: 4px; }
      .opt-3 .o3-small svg.i { width: 11px; height: 11px; }
      .opt-3 .o3-stopall { margin-left: auto; }
      .opt-3 .o3-tablewrap { flex: 1; min-height: 0; }
      .opt-3 .o3-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .opt-3 .o3-table thead th {
        position: sticky; top: 0; z-index: 2; text-align: left; padding: 6px 12px;
        font-family: var(--font-mono); font-size: 11px; font-weight: 400; letter-spacing: 0;
        color: var(--dim); background: var(--paper);
        border-bottom: 1px solid var(--line);
      }
      .opt-3 .o3-table th:nth-child(1) { width: 148px; }
      .opt-3 .o3-table th:nth-child(3) { width: 168px; }
      .opt-3 .o3-table th:nth-child(4) { width: 122px; }
      .opt-3 .o3-table th:nth-child(5) { width: 52px; }
      .opt-3 .o3-grouprow td {
        padding: 10px 12px 4px; border-bottom: 0; background: var(--paper);
      }
      .opt-3 .o3-group-title {
        display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--dim);
      }
      .opt-3 .o3-group-title svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-group-meta { margin-left: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-3 .o3-row td { padding: 8px 12px; border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent); }
      .opt-3 .o3-row { cursor: pointer; }
      .opt-3 .o3-row:hover td { background: color-mix(in oklab, var(--ink) 3%, transparent); }
      .opt-3 .o3-row.is-selected td { background: color-mix(in oklab, var(--ink) 6%, transparent); }
      .opt-3 .o3-row.is-selected td:first-child { box-shadow: inset 2px 0 0 var(--amber); }
      .opt-3 .o3-status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; white-space: nowrap; }
      .opt-3 .o3-name { display: table-cell; }
      .opt-3 .o3-name-text { display: block; font-size: 12.5px; font-weight: 500; }
      .opt-3 .o3-cmd { display: block; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-3 .o3-addr {
        display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 6px;
        border: 1px solid var(--line); background: var(--panel); max-width: 100%;
      }
      .opt-3 .o3-addr .m-mono { font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
      .opt-3 .o3-addr svg.i { width: 14px; height: 14px; color: var(--dim); flex: none; }
      .opt-3 .o3-addr:disabled { opacity: 0.55; }
      .opt-3 .o3-dash { color: var(--dim); }
      .opt-3 .o3-start { font-family: var(--font-mono); font-size: 11px; color: var(--dim); white-space: nowrap; }
      .opt-3 .o3-act { text-align: right; }
      .opt-3 .o3-stop {
        display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
        color: var(--dim); border: 1px solid transparent;
      }
      .opt-3 .o3-stop svg.i { width: 11px; height: 11px; }
      .opt-3 .o3-stop:hover { color: var(--danger); border-color: var(--line); background: var(--panel); }
      .opt-3 .o3-stop:disabled { opacity: 0.5; }
      .opt-3 .o3-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .opt-3 .o3-dock {
        flex: none; height: 322px; display: flex; flex-direction: column; gap: 4px;
        padding: 8px 12px 8px; border-top: 1px solid var(--line); background: var(--panel);
      }
      .opt-3 .o3-dock.is-empty { height: 120px; border-top: 1px solid var(--line); }
      .opt-3 .o3-dock-empty {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
        color: var(--dim); font-size: 12px;
      }
      .opt-3 .o3-dock-empty svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-dock-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      .opt-3 .o3-dock-name { font-family: var(--font-display); font-size: 13.5px; font-weight: 500; }
      .opt-3 .o3-dock-actions { margin-left: auto; display: flex; gap: 5px; }
      .opt-3 .o3-dock-head .o3-addr { margin-left: 4px; }
      .opt-3 .o3-error, .opt-3 .o3-check {
        display: flex; align-items: center; gap: 5px; font-size: 10.5px; padding: 3px 7px;
        border-radius: 5px; width: fit-content;
      }
      .opt-3 .o3-error { color: var(--danger); background: color-mix(in oklab, var(--danger) 7%, transparent); }
      .opt-3 .o3-check { color: var(--dim); background: var(--surface-muted); border-left: 2px solid var(--amber); }
      .opt-3 .o3-error svg.i { width: 11px; height: 11px; }
      .opt-3 .o3-dock-bar { display: flex; align-items: center; gap: 8px; }
      .opt-3 .o3-dock-bar > .m-label-mono { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; letter-spacing: 0; }
      .opt-3 .o3-dock-bar svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-tools { margin-left: auto; display: flex; gap: 2px; }
      .opt-3 .o3-tool {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 8px;
        font-size: 11.5px; color: var(--dim); border: 1px solid transparent;
      }
      .opt-3 .o3-tool svg.i { width: 14px; height: 14px; }
      .opt-3 .o3-tool:hover { color: var(--ink); }
      .opt-3 .o3-tool.is-on { border-color: color-mix(in oklab, var(--amber) 40%, var(--line)); background: color-mix(in oklab, var(--amber) 10%, transparent); color: var(--ink); }
      .opt-3 .o3-tool.is-follow { color: var(--amber-deep); border-color: color-mix(in oklab, var(--amber) 50%, var(--line)); background: color-mix(in oklab, var(--amber) 10%, transparent); }
      .opt-3 .o3-console {
        flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 12px 16px;
        border-radius: 12px; background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6; letter-spacing: 0;
      }
      .opt-3 .o3-console.is-wrapped { white-space: pre-wrap; word-break: break-word; }
      .opt-3 .o3-console:not(.is-wrapped) { white-space: pre; }
      .opt-3 .o3-line { display: block; }
      .opt-3 .o3-line.is-latest { border-left: 2px solid var(--amber); margin-left: -8px; padding-left: 8px; }
      .opt-3 .o3-dock-foot {
        display: flex; justify-content: space-between; gap: 8px; font-family: var(--font-mono);
        font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dim);
      }
      .opt-3 .o3-cu { padding: 12px; display: grid; gap: 10px; }
      .opt-3 .o3-cu-dockhead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .opt-3 .o3-cu-title { font-family: var(--font-mono); font-size: 12px; color: var(--dim); letter-spacing: 0; }
      .opt-3 .o3-cu-row { border: 1px solid var(--line); border-radius: 9px; background: var(--panel); padding: 2px; }
      .opt-3 .o3-cu-lines {
        display: grid; gap: 2px; padding: 10px 12px; border-radius: 8px;
        background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55;
      }
      .opt-3 .o3-cu-lines .is-latest { border-left: 2px solid var(--amber); margin-left: -8px; padding-left: 8px; }
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
            selected: now.selected === id ? (remaining[0]?.id ?? null) : now.selected,
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
          ctx.setState({ selected: el.dataset.id });
          const proc = state.processes.find((p) => p.id === el.dataset.id);
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
        full.refresh(ctx.getState());
      }

      function onKey(event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = event.target.closest?.('.o3-row[data-act="select"]');
        if (!row) return;
        event.preventDefault();
        ctx.setState({ selected: row.dataset.id });
      }

      function onScroll(event) {
        const target = event.target;
        if (!target.matches?.("[data-output]")) return;
        lastTop = target.scrollTop;
        const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 12;
        if (!atBottom && ctx.getState().follow) {
          ctx.patch({ follow: false });
          full.refresh(ctx.getState());
        } else if (atBottom && !ctx.getState().follow) {
          ctx.patch({ follow: true });
          full.refresh(ctx.getState());
        }
      }

      function render(el, state) {
        const out = root.querySelector("[data-output]");
        if (out && !state.follow) lastTop = out.scrollTop;
        WS.renderKeepFocus(el, shell(state));
        const next = el.querySelector("[data-output]");
        if (next) next.scrollTop = state.follow ? next.scrollHeight : lastTop;
      }

      const full = {
        refresh(state) {
          render(root, state);
          ctx.report(
            state.processes.length
              ? `${state.processes.length} processes · ${mock.checks(state.processes)} to check`
              : "Nothing running",
          );
        },
      };

      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("keydown", onKey);
      root.addEventListener("scroll", onScroll, true);

      return {
        update(state) {
          full.refresh(state);
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
        label: "Table row, selected",
        mount(root) {
          const [p1, p2] = mock.scenarioProcesses("mixed");
          root.innerHTML = `<div class="o3-cu">
            <div class="o3-cu-title">Process rows</div>
            <div class="o3-cu-row ${""}">${mock.row(p1, { selected: true })}</div>
            <div class="o3-cu-row">${mock.row(p2, {})}</div>
            <p class="m-label-mono">Addresses open the site; the row selects it into the dock.</p>
          </div>`;
          return { update() {} };
        },
      },
      {
        label: "Dock header and output bar",
        mount(root) {
          root.innerHTML = `<div class="o3-cu">
            <div class="o3-cu-dockhead">
              <span class="m-dot" data-tone="ok"></span><b>Development server</b>
              <span class="m-status-text" data-tone="ok">Running</span>
              <span class="o3-addr"><span class="m-mono">127.0.0.1:5173</span>${icons.copy}</span>
            </div>
            <div class="o3-dock-bar">
              <span class="m-label-mono">${icons.terminal} Scrolled back</span>
              <div class="o3-tools">
                <span class="o3-tool is-follow">${icons.arrowDown} Follow latest</span>
                <span class="o3-tool is-on" aria-pressed="true">${icons.wrap} Wrap lines</span>
              </div>
            </div>
            <div class="o3-cu-lines">
              <span>2:41:03 PM GET /api/projects/2b6f/processes 200 3ms</span>
              <span>2:41:09 PM GET /api/processes/0c7a/output?after=902 200 1ms</span>
              <span class="is-latest">2:41:11 PM [vite] hmr update /src/styles.css</span>
            </div>
          </div>`;
          return { update() {} };
        },
      },
    ],
  });
})();
