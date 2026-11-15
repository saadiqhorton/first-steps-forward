/* Option 1 — Ledger: a project section with the list on the left and the
 * selected process (details + output) on the right. Enjoy's own arrangement,
 * rebuilt in ADE's Conversations split. */
(function () {
  "use strict";

  const { icons, mock } = WS;
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function statusChip(proc) {
    const meta = mock.statusMeta(proc.status);
    return `<span class="o1-chip" data-tone="${meta.tone}"><span class="m-dot" data-tone="${meta.tone}"></span>${meta.label}</span>`;
  }

  function detail(state) {
    const proc = state.processes.find((p) => p.id === state.selected);
    if (!proc) {
      if (!state.processes.length)
        return `<div class="o1-detail-empty">${mock.emptyState()}</div>`;
      return `<div class="o1-detail-empty"><p class="m-label-mono">Select a process to read its output.</p></div>`;
    }
    const address = mock.addressOf(proc);
    const meta = mock.statusMeta(proc.status);
    const lines = mock.outputOf(proc, state.outputLines);
    const conversation = mock.conversations.find((c) => c.id === proc.conversationId);
    return `
      <div class="o1-detail-head">
        <div class="o1-detail-title">
          <h2>${esc(proc.name)}</h2>${statusChip(proc)}
          <button type="button" class="m-icon-btn o1-more" data-act="menu" data-focus="menu"
            aria-label="Process actions" aria-expanded="${state.menuOpen ? "true" : "false"}">${icons.more}</button>
          ${
            state.menuOpen
              ? `<div class="o1-menu" role="menu">
                  <button type="button" role="menuitem" data-act="stop-all" data-focus="menu-stop-all">Stop all</button>
                  <button type="button" role="menuitem" data-act="copy" data-id="${proc.id}" data-focus="menu-copy">Copy address</button>
                  <button type="button" role="menuitem" data-act="mark-good" data-id="${proc.id}" data-focus="menu-good">Mark as good</button>
                </div>`
              : ""
          }
        </div>
        <div class="o1-address">
          ${
            address
              ? `<button type="button" class="o1-address-copy" data-act="copy" data-id="${proc.id}"
                  data-focus="copy-address" title="Copy address">
                  <span class="m-mono">${esc(address)}</span>${icons.copy}
                </button>
                <button type="button" class="m-btn-quiet o1-open" data-act="open" data-id="${proc.id}"
                  data-focus="open-browser" ${proc.status === "running" ? "" : "disabled"}>Open in browser ${icons.external}</button>`
              : `<span class="m-label-mono">This process serves no website.</span>`
          }
        </div>
        <div class="o1-meta">
          <span>${esc(proc.startedAt)}</span><span class="o1-meta-sep">·</span>
          <button type="button" class="o1-conv-link" data-act="select-conversation">${esc(conversation?.title)} ${icons.chevronRight}</button>
        </div>
        ${
          proc.status === "failed" && proc.stopError
            ? `<div class="o1-error" role="alert">${icons.alert}<div><b>Couldn't stop it</b> · ${esc(proc.stopError)}</div></div>`
            : ""
        }
        ${
          proc.status === "unverified"
            ? `<div class="o1-check"><div>ADE can't confirm this is still running. Read the output, then mark it as good.</div>
                <button type="button" class="m-btn-quiet o1-small" data-act="mark-good" data-id="${proc.id}" data-focus="mark-good">Mark as good</button></div>`
            : ""
        }
        <div class="o1-actions">
          <button type="button" class="m-btn-quiet o1-small o1-stop" data-act="stop" data-id="${proc.id}"
            data-focus="stop" ${proc.status === "stopping" ? "disabled" : ""}>
            ${proc.status === "stopping" ? icons.loader : icons.square}
            ${proc.status === "stopping" ? "Stopping…" : proc.status === "failed" ? "Retry stop" : "Stop"}
          </button>
          <span class="o1-owner">Started by ${esc(conversation?.agent)}</span>
        </div>
      </div>

      <div class="o1-details">
        <h3 class="o1-section-title">Process details</h3>
        <dl>
          <div><dt>Folder</dt><dd class="m-mono">${esc(proc.cwd && proc.cwd !== "." ? proc.cwd : "project root")}</dd></div>
          <div><dt>Command</dt><dd class="m-mono o1-cmd">${esc(proc.command)}</dd></div>
          <div><dt>Address</dt><dd class="m-mono">${address ? esc(address) : "—"}</dd></div>
          <div><dt>Source</dt><dd>${esc(proc.source)}</dd></div>
          <div><dt>Process</dt><dd class="m-mono">${proc.pid ? `pid ${proc.pid}` : "recorded by ADE"}</dd></div>
        </dl>
      </div>

      <div class="o1-output">
        <div class="o1-output-bar">
          <span class="o1-output-following">${icons.terminal} ${state.follow ? "Following log" : "Scrolled back"}</span>
          <div class="o1-output-tools">
            ${state.follow ? "" : `<button type="button" class="o1-tool is-follow" data-act="follow" data-focus="follow">${icons.arrowDown} Follow latest</button>`}
            <button type="button" class="o1-tool ${state.wrap ? "is-on" : ""}" data-act="wrap" data-focus="wrap"
              aria-pressed="${state.wrap}">${icons.wrap} Wrap lines</button>
          </div>
        </div>
        <pre class="o1-console ${state.wrap ? "is-wrapped" : ""}" data-output tabindex="0"
          aria-label="Output of ${esc(proc.name)}">${lines
            .map(
              (l, index) =>
                `<span class="o1-line${index === lines.length - 1 ? " is-latest" : ""}">${esc(l) || " "}</span>`,
            )
            .join("")}</pre>
        <div class="o1-output-foot"><span>${lines.length} lines</span><span>${meta.label}</span></div>
      </div>`;
  }

  function listBody(state) {
    const found = mock.groups(state.processes, state.query);
    if (!state.processes.length) return `<div class="m-empty"><p>Nothing running yet</p></div>`;
    if (!found.length)
      return `<div class="m-empty"><p>No processes match “${esc(state.query)}”</p></div>`;
    return found
      .map(
        ({ conversation, processes }) => `
        <section class="o1-group" aria-label="${esc(conversation.title)}">
          ${mock.conversationHead(conversation)}
          ${processes.map((p) => mock.row(p, { selected: p.id === state.selected, open: true })).join("")}
        </section>`,
      )
      .join("");
  }

  function shell(state) {
    const checkCount = mock.checks(state.processes);
    return `${mock.chrome("processes", state.processes.length)}
      <div class="o1-body">
        <aside class="o1-list" aria-label="Processes">
          <div class="o1-list-head">
            <div class="o1-list-title"><h2>Processes</h2></div>
            <div class="o1-search">
              ${icons.search}
              <input type="search" data-act="search" data-focus="search" value="${esc(state.query)}"
                placeholder="Search processes…" aria-label="Search processes" />
            </div>
          </div>
          ${
            checkCount
              ? `<div class="o1-checks"><span class="o1-check-dot"></span>
                  <span>${checkCount} ${checkCount === 1 ? "process needs" : "processes need"} checking</span>
                  <button type="button" class="o1-link" data-act="mark-all" data-focus="mark-all">Mark all as good</button></div>`
              : ""
          }
          <div class="m-scroll o1-list-scroll">${listBody(state)}</div>
          <div class="o1-list-foot">
            <span class="m-label-mono">${state.processes.length} ${state.processes.length === 1 ? "process" : "processes"}</span>
            <button type="button" class="o1-link" data-act="stop-all" data-focus="stop-all">Stop all</button>
          </div>
        </aside>
        <section class="o1-detail" aria-label="Selected process">${detail(state)}</section>
      </div>
      ${state.confirmStopAll ? mock.confirmDialog(state.processes) : ""}
      ${mock.notice(state.notice?.text, state.notice?.tone)}`;
  }

  WS.register({
    id: 1,
    name: "Ledger",
    tradeoff:
      "Enjoy's own split: a grouped list beside details and output. Best for reading and managing at once; the project tab row does the navigating.",
    notes: [
      "Processes is a <b>project section</b>, like Conversations: the left column groups rows under the conversation that started them.",
      "The right pane keeps details and output visible together, with the address, copy, <b>Open in browser</b> and <b>Stop</b> at the top.",
      "Output has its own bar: <b>Wrap lines</b>, <b>Follow latest</b> and a line count; scrolling up parks the follow until you ask for it.",
      "Needs-checking rows surface a count and <b>Mark all as good</b> above the list, exactly where Enjoy puts the reminder.",
      "In the real code this is a new <code>/p/$projectId/processes</code> route plus a section tab; the right pane reuses the Conversations split.",
    ],
    css: `
      .opt-1 .o1-body { display: flex; flex: 1; min-height: 0; }
      .opt-1 .o1-list {
        width: 330px; flex: none; display: flex; flex-direction: column; min-height: 0;
        border-right: 1px solid var(--line); background: var(--paper);
      }
      .opt-1 .o1-list-head { padding: 12px 12px 8px; display: grid; gap: 8px; }
      .opt-1 .o1-list-title { display: flex; align-items: center; gap: 6px; }
      .opt-1 .o1-list-title h2 {
        margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500;
      }
      .opt-1 .o1-search {
        display: flex; align-items: center; gap: 6px; padding: 0 9px;
        border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--dim);
      }
      .opt-1 .o1-search svg.i { width: 13px; height: 13px; }
      .opt-1 .o1-search input {
        flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
        padding: 7px 0; font-size: 12.5px;
      }
      .opt-1 .o1-checks {
        display: flex; align-items: center; gap: 8px; margin: 0 8px 4px;
        padding: 8px; border-bottom: 1px solid var(--line);
        font-size: 12px; color: var(--dim);
      }
      .opt-1 .o1-check-dot {
        width: 6px; height: 6px; flex: none; border-radius: 999px; background: var(--amber);
      }
      .opt-1 .o1-link {
        font-size: 11.5px; color: var(--dim); padding: 2px 4px; border-radius: 5px; flex: none;
      }
      .opt-1 .o1-link:hover { color: var(--ink); background: color-mix(in oklab, var(--ink) 5%, transparent); }
      .opt-1 .o1-checks .o1-link { color: var(--ink); margin-left: auto; }
      .opt-1 .o1-list-scroll { padding: 4px 8px 12px; }
      .opt-1 .o1-group + .o1-group {
        margin-top: 8px; padding-top: 8px;
        border-top: 1px solid color-mix(in oklab, var(--line) 70%, transparent);
      }
      .opt-1 .o1-list-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 12px; border-top: 1px solid var(--line); background: var(--panel);
      }
      .opt-1 .o1-detail {
        flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
        background: var(--panel); padding: 16px 20px;
      }
      .opt-1 .o1-detail-empty { flex: 1; display: grid; place-items: center; }
      .opt-1 .o1-detail-head { display: grid; gap: 8px; flex: none; }
      .opt-1 .o1-detail-title { display: flex; align-items: center; gap: 8px; position: relative; }
      .opt-1 .o1-detail-title h2 {
        margin: 0; font-family: var(--font-display); font-size: 19px; font-weight: 500;
        letter-spacing: -0.02em;
      }
      .opt-1 .o1-chip {
        display: inline-flex; align-items: center; gap: 6px; flex: none;
        font-family: var(--font-mono); font-size: 11.5px; color: var(--dim);
      }
      .opt-1 .o1-chip[data-tone="ok"] { color: var(--teal); }
      .opt-1 .o1-chip[data-tone="warn"] { color: var(--amber-deep); }
      .opt-1 .o1-chip[data-tone="bad"] { color: var(--danger); }
      .opt-1 .o1-more { margin-left: auto; }
      .opt-1 .o1-menu {
        position: absolute; right: 0; top: 30px; z-index: 12; width: 210px;
        padding: 4px; border: 1px solid var(--line); border-radius: 10px;
        background: var(--surface-raised); box-shadow: var(--shadow-floating);
        display: grid;
      }
      .opt-1 .o1-menu button {
        text-align: left; padding: 6px 8px; border-radius: 6px; font-size: 12px;
      }
      .opt-1 .o1-menu button:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); }
      .opt-1 .o1-address { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .opt-1 .o1-address-copy {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 7px;
        border-radius: 7px; border: 1px solid var(--line); background: var(--paper);
      }
      .opt-1 .o1-address-copy svg.i { width: 12px; height: 12px; color: var(--dim); }
      .opt-1 .o1-address-copy:hover { border-color: var(--amber); }
      .opt-1 .o1-open { font-size: 11.5px; padding: 4px 9px; }
      .opt-1 .o1-open:disabled { opacity: 0.45; }
      .opt-1 .o1-open svg.i { width: 12px; height: 12px; }
      .opt-1 .o1-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dim); }
      .opt-1 .o1-conv-link { display: inline-flex; align-items: center; gap: 4px; color: var(--dim); font-size: 12px; }
      .opt-1 .o1-conv-link:hover { color: var(--ink); }
      .opt-1 .o1-conv-link svg.i { width: 11px; height: 11px; }
      .opt-1 .o1-error, .opt-1 .o1-check {
        display: flex; align-items: center; gap: 8px; justify-content: space-between;
        padding: 8px 12px; border-radius: 8px; font-size: 12px;
      }
      .opt-1 .o1-error {
        border: 1px solid var(--line); border-left: 2px solid var(--danger);
        background: var(--surface-muted); color: var(--danger);
      }
      .opt-1 .o1-check {
        border: 1px solid var(--line); border-left: 2px solid var(--amber);
        background: var(--surface-muted); color: var(--dim);
      }
      .opt-1 .o1-error svg.i { width: 14px; height: 14px; }
      .opt-1 .o1-small { font-size: 11.5px; padding: 4px 10px; }
      .opt-1 .o1-stop svg.i { width: 14px; height: 14px; }
      .opt-1 .o1-stop:disabled { opacity: 0.6; }
      .opt-1 .o1-actions { display: flex; align-items: center; gap: 10px; }
      .opt-1 .o1-owner { font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-1 .o1-details { flex: none; display: grid; gap: 6px; padding-top: 12px; }
      .opt-1 .o1-section-title {
        margin: 0; font-family: var(--font-mono); font-size: 12px; font-weight: 400;
        letter-spacing: 0; color: var(--dim);
      }
      .opt-1 .o1-details dl {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 0;
      }
      .opt-1 .o1-details dl > div { display: flex; gap: 8px; min-width: 0; font-size: 12px; }
      .opt-1 .o1-details dt { flex: none; width: 64px; color: var(--dim); font-family: var(--font-mono); font-size: 11.5px; }
      .opt-1 .o1-details dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opt-1 .o1-cmd { direction: ltr; }
      .opt-1 .o1-output { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: 12px; }
      .opt-1 .o1-output-bar { display: flex; align-items: center; gap: 10px; padding-bottom: 6px; }
      .opt-1 .o1-output-following {
        display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono);
        font-size: 11.5px; color: var(--dim); letter-spacing: 0;
      }
      .opt-1 .o1-output-following svg.i { width: 11px; height: 11px; }
      .opt-1 .o1-output-tools { margin-left: auto; display: flex; align-items: center; gap: 4px; }
      .opt-1 .o1-tool {
        display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px;
        border-radius: 8px; font-size: 11.5px; color: var(--dim); border: 1px solid transparent;
      }
      .opt-1 .o1-tool.is-on { color: var(--ink); border-color: color-mix(in oklab, var(--amber) 40%, var(--line)); background: color-mix(in oklab, var(--amber) 10%, transparent); }
      .opt-1 .o1-tool.is-follow { color: var(--amber-deep); border-color: color-mix(in oklab, var(--amber) 50%, var(--line)); background: color-mix(in oklab, var(--amber) 10%, transparent); }
      .opt-1 .o1-tool svg.i { width: 14px; height: 14px; }
      .opt-1 .o1-tool:hover { color: var(--ink); background: color-mix(in oklab, var(--ink) 5%, transparent); }
      .opt-1 .o1-console {
        flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 12px 16px;
        border-radius: 12px; border: 1px solid color-mix(in oklab, var(--deck) 60%, var(--line));
        background: var(--deck); color: var(--deck-foreground);
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6; letter-spacing: 0;
      }
      .opt-1 .o1-console.is-wrapped { white-space: pre-wrap; word-break: break-word; }
      .opt-1 .o1-console:not(.is-wrapped) { white-space: pre; }
      .opt-1 .o1-line { display: block; }
      .opt-1 .o1-line.is-latest { border-left: 2px solid var(--amber); margin-left: -8px; padding-left: 8px; }
      .opt-1 .o1-output-foot {
        display: flex; justify-content: space-between; padding-top: 8px;
        font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums;
        color: var(--dim);
      }
      .opt-1 .o1-cu-inner { padding: 18px 16px; }
      .opt-1 .o1-cu-bar { display: grid; gap: 10px; padding: 18px 16px; }
      .opt-1 .o1-cu-foot { display: flex; justify-content: space-between; }
    `,
    initialState() {
      return { menuOpen: false };
    },
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
        const name = result.proc.name;
        if (!result.removed) {
          ctx.setState({ notice: { text: `Couldn't stop ${name}. Open it to read why.`, tone: "error" } });
          return;
        }
        ctx.report(`Stop requested: ${name}`);
        ctx.setState({ notice: { text: `Stopping ${name}…` } });
        later(() => {
          const now = ctx.getState();
          const remaining = now.processes.filter((p) => p.id !== id);
          ctx.setState({
            processes: remaining,
            selected: now.selected === id ? (remaining[0]?.id ?? null) : now.selected,
            notice: { text: `${name} stopped` },
          });
        }, 1200);
      }

      function stopAll() {
        const state = ctx.getState();
        if (!state.confirmStopAll) {
          ctx.setState({ confirmStopAll: true, menuOpen: false });
          return;
        }
        const count = state.processes.length;
        for (const proc of state.processes) proc.status = "stopping";
        ctx.setState({ confirmStopAll: false, notice: { text: `Stopping ${count} processes…` } });
        later(() => {
          ctx.setState({
            processes: [],
            selected: null,
            notice: { text: `Stopped ${count} processes` },
          });
        }, 1300);
      }

      function onClick(event) {
        const el = event.target.closest("[data-act]");
        if (!el || !root.contains(el)) return;
        const act = el.dataset.act;
        const state = ctx.getState();
        if (act === "select") {
          ctx.setState({ selected: el.dataset.id, menuOpen: false });
          const proc = state.processes.find((p) => p.id === el.dataset.id);
          if (proc) ctx.report(`${proc.name} · ${mock.statusMeta(proc.status).label}`);
        } else if (act === "open") {
          ctx.setState({
            notice: {
              text: `Opening ${mock.addressOf(state.processes.find((p) => p.id === el.dataset.id))} in the agent browser (mock).`,
            },
          });
        } else if (act === "copy") {
          const proc = state.processes.find((p) => p.id === el.dataset.id);
          const address = proc && mock.addressOf(proc);
          if (address) {
            navigator.clipboard?.writeText(`http://${address}/`).catch(() => {});
            ctx.report(`Copied ${address}`);
            ctx.setState({ notice: { text: "Address copied", tone: "info" }, menuOpen: false });
          }
        } else if (act === "mark-good") {
          mock.markGood(state, el.dataset.id);
          ctx.setState({ notice: { text: "Marked as good" }, menuOpen: false });
        } else if (act === "mark-all") {
          const count = mock.markAllGood(state);
          ctx.setState({ notice: { text: `Marked ${count} ${count === 1 ? "process" : "processes"} as good.` } });
        } else if (act === "stop") {
          stop(el.dataset.id);
        } else if (act === "stop-all") {
          stopAll();
        } else if (act === "cancel-stop-all") {
          ctx.setState({ confirmStopAll: false });
        } else if (act === "confirm-stop-all") {
          stopAll();
        } else if (act === "wrap") {
          ctx.setState({ wrap: !state.wrap });
        } else if (act === "follow") {
          ctx.setState({ follow: true });
        } else if (act === "menu") {
          ctx.setState({ menuOpen: !state.menuOpen });
        } else if (act === "select-conversation") {
          ctx.setState({ notice: { text: "Switching to the conversation (mock)." } });
        }
      }

      function onInput(event) {
        if (event.target.matches('[data-act="search"]')) {
          ctx.patch({ query: event.target.value });
          full.refresh(ctx.getState());
        }
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

      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("scroll", onScroll, true);

      function renderFull(state, el) {
        const out = root.querySelector("[data-output]");
        const top = out ? out.scrollTop : lastTop;
        if (!state.follow && out) lastTop = top;
        WS.renderKeepFocus(el, shell(state));
        const next = el.querySelector("[data-output]");
        if (next) next.scrollTop = state.follow ? next.scrollHeight : lastTop;
      }

      const full = {
        refresh(state) {
          renderFull(state, root);
          ctx.report(
            state.processes.length
              ? `${state.processes.length} processes · ${mock.checks(state.processes)} to check`
              : "Nothing running",
          );
        },
        update(state) {
          full.refresh(state);
        },
      };

      return {
        update(state) {
          full.update(state);
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
        label: "One row, with its address and Open",
        mount(root) {
          this.rowRoot = root;
          root.dataset.mockTheme = "light";
          const proc = mock.scenarioProcesses("mixed")[0];
          root.innerHTML = `<div class="o1-cu-inner">${mock.row(proc, { selected: true, open: true })}</div>`;
          return { update() {} };
        },
      },
      {
        label: "The output bar, scrolled back",
        mount(root) {
          root.innerHTML = `<div class="o1-cu-bar">
            <div class="o1-output-bar">
              <span class="o1-output-following">${icons.terminal} Scrolled back</span>
              <div class="o1-output-tools">
                <button type="button" class="o1-tool is-follow">${icons.arrowDown} Follow latest</button>
                <button type="button" class="o1-tool is-on" aria-pressed="true">${icons.wrap} Wrap lines</button>
              </div>
            </div>
            <div class="o1-cu-foot"><span class="m-label-mono">42 lines</span><span class="m-label-mono">Wrapping</span></div>
          </div>`;
          return { update() {} };
        },
      },
    ],
  });
})();
