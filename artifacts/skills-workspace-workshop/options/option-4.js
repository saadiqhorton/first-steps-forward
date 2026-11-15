/* Option 4 — Import console.
 * A permanent import console on top: what is being installed, which skills you
 * picked, and where they land. The library underneath stays a compact list. */
(function () {
  "use strict";

  const { icons, mock } = window.WS;

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function consoleHtml(ctx) {
    const state = ctx.getState();
    const pkg = state.staged || mock.packages[state.packageKey];
    const phase = state.importPhase;

    if (phase === "error") {
      return `<section class="c-console c-console-error" aria-label="Import">
        <div class="c-console-icon">${icons.alert}</div>
        <div class="min-w-0">
          <h2>${esc(pkg.fileName)} is not a skill package</h2>
          <p>${esc(pkg.error)}</p>
        </div>
        <button type="button" class="m-btn-quiet m-btn" data-act="pick-file" data-focus="pick-again">Choose another file</button>
      </section>`;
    }

    if (phase === "pick") {
      return `<section class="c-console" aria-label="Import">
        <div class="c-console-icon">${icons.upload}</div>
        <div class="min-w-0">
          <h2>Import a skill package</h2>
          <p>A <code>.skill</code> file, or a <code>.zip</code> that holds one or more skills. Each skill needs a <code>SKILL.md</code> with a name and a description.</p>
        </div>
        <button type="button" class="m-btn-amber m-btn" data-act="pick-file" data-focus="pick-file">Choose a package</button>
      </section>`;
    }

    const picked = pkg.skills.filter((_, index) => (state.picked || []).includes(index));

    return `<section class="c-console c-console-staged" aria-label="Import">
      <div class="c-console-head">
        <div class="min-w-0">
          <h2>${esc(pkg.fileName)}</h2>
          <p class="m-label-mono">${esc(pkg.kind)} · ${esc(pkg.size)} · ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"} found</p>
        </div>
        <button type="button" class="m-btn-quiet m-btn" data-act="cancel-import">Discard</button>
      </div>
      <div class="c-pick-list">
        ${pkg.skills
          .map((s, index) => {
            const on = (state.picked || []).includes(index);
            return `<button type="button" class="c-pick${on ? " is-on" : ""}" data-act="toggle-pick" data-i="${index}" aria-pressed="${on}" data-focus="pick-${index}">
              <span class="c-check" aria-hidden="true">${on ? icons.check : ""}</span>
              <span class="min-w-0 c-pick-text">
                <b class="m-truncate">${esc(s.name)}</b>
                <span class="m-truncate">${esc(s.description)}</span>
                <span class="c-pick-files">${s.files.map((f) => `<span class="m-pill">${esc(f.path)}</span>`).join("")}</span>
                ${(s.warnings || []).length ? `<span class="c-pick-warn">${icons.alert}${esc(s.warnings[0])}</span>` : ""}
              </span>
            </button>`;
          })
          .join("")}
      </div>
      <div class="c-console-foot">
        <div class="c-scope">
          <span class="m-field-label">Install into</span>
          ${mock.scopes
            .map(
              (scope) =>
                `<button type="button" class="c-scope-option${state.importScope === scope.id ? " is-on" : ""}" data-act="scope" data-v="${scope.id}" data-focus="scope-${scope.id}" title="${esc(scope.hint)}">
                  <b>${esc(scope.label)}</b><span class="m-label-mono">${esc(scope.path)}</span>
                  <span class="c-scope-hint">${esc(scope.hint)}</span>
                </button>`,
            )
            .join("")}
        </div>
        <button type="button" class="m-btn-amber m-btn" data-act="do-import" data-focus="do-import" ${picked.length ? "" : "disabled"}>Install ${picked.length} skill${picked.length === 1 ? "" : "s"}</button>
      </div>
    </section>`;
  }

  function libraryRowHtml(skill, state) {
    const editing = state.editing === skill.id;
    const kinds = mock.bundledKinds(skill);
    const draft = state.draft || { name: skill.name, description: skill.description };
    const nameError = mock.validateName(draft.name);
    const descError = mock.validateDescription(draft.description);

    if (editing) {
      return `<li class="c-row c-row-editing">
        <div class="c-row-fields">
          <input class="m-input" data-focus="c-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off" aria-label="Skill name">
          <p class="c-hint" data-hint="name"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens.")}</p>
          <textarea class="m-textarea" rows="2" data-focus="c-desc" data-field="description" placeholder="Use this skill when …" aria-label="Skill description">${esc(draft.description)}</textarea>
          <p class="c-hint" data-hint="description"${descError ? ' data-error="true"' : ""}>${esc(descError || "Say what it does and when to use it.")}</p>
        </div>
        <div class="c-row-actions">
          <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="c-save" ${nameError || descError ? "disabled" : ""}>Save</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
        </div>
      </li>`;
    }

    return `<li class="c-row">
      <button type="button" class="c-row-main" data-act="select" data-id="${esc(skill.id)}" data-focus="c-row-${esc(skill.id)}" data-name="${esc(skill.name.toLowerCase())}" aria-expanded="${state.selected === skill.id}">
        <span class="c-icon" aria-hidden="true">${icons.sparkles}</span>
        <span class="c-row-name m-truncate">${esc(skill.name)}</span>
        <span class="c-row-desc m-truncate">${esc(skill.description)}</span>
        <span class="c-row-files">
          ${kinds.length ? kinds.map((k) => `<span class="m-pill">${k.count} ${esc(k.label.toLowerCase())}</span>`).join("") : `<span class="m-label-mono">SKILL.md</span>`}
        </span>
        <span class="m-label-mono c-row-scope">${esc(skill.scope === "ade-project" ? "This project" : skill.scope === "ade-user" ? "My ADE" : "Found")}</span>
      </button>
      <span class="c-row-tools">
        ${skill.fresh ? `<span class="m-pill" data-tone="new">new</span>` : ""}
        ${
          skill.owned
            ? `<button type="button" class="m-icon-btn" data-act="edit" data-id="${esc(skill.id)}" aria-label="Edit ${esc(skill.name)}" data-focus="c-edit-${esc(skill.id)}">${icons.pencil}</button>
               <button type="button" class="m-icon-btn" data-act="remove" data-id="${esc(skill.id)}" aria-label="Remove ${esc(skill.name)}" data-focus="c-remove-${esc(skill.id)}">${icons.trash}</button>`
            : `<button type="button" class="m-icon-btn" data-act="copy-to-ade" data-id="${esc(skill.id)}" aria-label="Copy ${esc(skill.name)} into ADE" data-focus="c-copy-${esc(skill.id)}">${icons.copy}</button>`
        }
      </span>
    </li>`;
  }

  function libraryHtml(ctx) {
    const state = ctx.getState();
    const term = state.query.trim().toLowerCase();
    const hidden = mock.hiddenFoundSkills(state.library, state.detectFound);
    const shown = mock
      .visibleSkills(state.library, state.detectFound)
      .filter((s) =>
        !term
          ? true
          : s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term),
      );

    return `<section class="c-library">
      <div class="c-library-head">
        <h2>Library <span class="m-label-mono">${state.library.filter((s) => s.scope === "ade-project").length} in ADE</span></h2>
        <div class="c-library-tools">
          <div class="c-search">
            ${icons.search}
            <input type="search" value="${esc(state.query)}" placeholder="Search" aria-label="Search skills" data-focus="c-search" data-field="query">
          </div>
          ${
            hidden.length
              ? `<button type="button" class="c-detect" data-act="show-project" data-focus="show-project">${icons.folder}<span>${hidden.length} in .agents/skills</span><b>Show</b></button>`
              : ""
          }
          <button type="button" class="m-btn-amber m-btn" data-act="new" data-focus="c-new">${icons.plus}New skill</button>
        </div>
      </div>
      ${
        state.editing === "new"
          ? `<li class="c-row c-row-editing">
              <div class="c-row-fields">
                <input class="m-input" data-focus="c-name" data-field="name" value="${esc((state.draft || {}).name || "")}" placeholder="my-skill" autocomplete="off" aria-label="Skill name">
                <textarea class="m-textarea" rows="2" data-focus="c-desc" data-field="description" placeholder="Use this skill when …" aria-label="Skill description">${esc((state.draft || {}).description || "")}</textarea>
                <p class="c-hint">A skill needs a name and a description. Files can follow.</p>
              </div>
              <div class="c-row-actions">
                <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="c-save">Create skill</button>
                <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
              </div>
            </li>`
          : ""
      }
      <ul class="c-rows">
        ${shown.length ? shown.map((s) => libraryRowHtml(s, state)).join("") : `<li class="m-empty">No skills match this search.</li>`}
      </ul>
    </section>`;
  }

  function handleClick(e, ctx) {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const state = ctx.getState();

    if (act === "pick-file") {
      const pkg = mock.packages[state.packageKey];
      ctx.setState({
        staged: pkg,
        importPhase: pkg.error ? "error" : "staged",
        picked: pkg.skills ? pkg.skills.map((_, i) => i) : [],
      });
      return;
    }
    if (act === "cancel-import") {
      ctx.setState({ importPhase: "pick", staged: null, picked: [] });
      return;
    }
    if (act === "toggle-pick") {
      const index = Number(button.dataset.i);
      const picked = [...(state.picked || [])];
      const at = picked.indexOf(index);
      if (at >= 0) picked.splice(at, 1);
      else picked.push(index);
      ctx.setState({ picked });
      return;
    }
    if (act === "scope") {
      ctx.setState({ importScope: button.dataset.v });
      return;
    }
    if (act === "do-import") {
      const pkg = state.staged || mock.packages[state.packageKey];
      if (!pkg || pkg.error) return;
      const chosen = {
        ...pkg,
        skills: pkg.skills.filter((_, index) => (state.picked || []).includes(index)),
      };
      if (!chosen.skills.length) return;
      const library = mock.importInto(state.library, chosen, state.importScope);
      ctx.setState({
        library,
        importPhase: "pick",
        staged: null,
        picked: [],
        notice: {
          text: `Installed ${chosen.skills.length} skill${chosen.skills.length === 1 ? "" : "s"}`,
        },
      });
      return;
    }
    if (act === "select") {
      ctx.setState({ selected: button.dataset.id });
      return;
    }
    if (act === "edit") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill || !skill.owned) return;
      ctx.setState({
        editing: skill.id,
        draft: { name: skill.name, description: skill.description },
      });
      return;
    }
    if (act === "copy-to-ade") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill) return;
      const copy = {
        ...skill,
        id: `ade-${skill.folder}`,
        scope: "ade-project",
        path: mock.pathFor("ade-project", skill.folder),
        owned: true,
        fresh: true,
        updated: "just now",
      };
      ctx.setState({
        library: [...state.library.filter((s) => s.id !== skill.id), copy],
        editing: null,
        notice: { text: `Copied “${skill.name}” into ~/.ade/skills` },
      });
      return;
    }
    if (act === "new") {
      ctx.setState({ editing: "new", draft: { name: "", description: "" } });
      return;
    }
    if (act === "cancel-edit") {
      ctx.setState({ editing: null, draft: null });
      return;
    }
    if (act === "save") {
      const draft = state.draft || { name: "", description: "" };
      const name = draft.name.trim();
      if (mock.validateName(name) || mock.validateDescription(draft.description)) return;
      if (state.editing === "new") {
        const scope = state.newScope || "ade-project";
        const skill = {
          id: `yours-${name}`,
          name,
          folder: name,
          description: draft.description.trim(),
          scope,
          path: mock.pathFor(scope, name),
          files: [{ path: "SKILL.md", bytes: "0.4 KB" }],
          body: "",
          updated: "just now",
        };
        ctx.setState({
          library: [...state.library, skill],
          editing: null,
          draft: null,
          notice: { text: `Created “${name}”` },
        });
        return;
      }
      const library = state.library.map((s) =>
        s.id === state.editing
          ? {
              ...s,
              name,
              folder: name,
              description: draft.description.trim(),
              path: mock.pathFor(s.scope, name),
              updated: "just now",
            }
          : s,
      );
      ctx.setState({ library, editing: null, draft: null, notice: { text: `Saved “${name}”` } });
      return;
    }
    if (act === "remove") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill || !skill.owned) return;
      ctx.setState({
        library: state.library.filter((s) => s.id !== skill.id),
        editing: null,
        notice: { text: `Removed “${skill.name}”` },
      });
    }
  }

  function handleInput(e, ctx) {
    const field = e.target.dataset.field;
    if (!field) return;
    if (field === "query") {
      ctx.patch({ query: e.target.value });
      const term = ctx.getState().query.trim().toLowerCase();
      ctx.root.querySelectorAll(".c-row-main").forEach((row) => {
        row.style.display = !term || (row.dataset.name || "").includes(term) ? "" : "none";
      });
      return;
    }
    const draft = { ...(ctx.getState().draft || { name: "", description: "" }) };
    draft[field] = e.target.value;
    ctx.patch({ draft });
    const hint = ctx.root.querySelector(`[data-hint="${field}"]`);
    if (hint) {
      const error =
        field === "name"
          ? mock.validateName(draft.name)
          : mock.validateDescription(draft.description);
      hint.textContent =
        error ||
        (field === "name"
          ? "Lowercase letters, numbers and hyphens."
          : "Say what it does and when to use it.");
      if (hint.hasAttribute("data-error")) delete hint.dataset.error;
    }
  }

  WS.register({
    id: 4,
    name: "Import console",
    tradeoff:
      "Importing is the risky step, so it gets a permanent console with per-skill choices, but the library is pushed down and reads as secondary.",
    notes: [
      "The console is always on screen. It starts as a drop target, becomes a list of the skills found in the package, and lets you tick the ones you want.",
      "Each found skill shows its files before you install it, plus a warning when the name in the frontmatter does not match the folder — the spec asks for a match, and clients load it anyway.",
      "The library below is a compact list. Editing happens in place, on the row, so nothing opens over the list.",
      "Installing always lands in ADE's own set (<code>~/.ade/skills</code>) unless you pick another scope, so an imported package never litters the repository.",
      "In the real code this is the shape that fits packaged skills arriving from a team or a marketplace: the install step is the thing you review, not the browsing.",
    ],
    css: `
      .opt-4 .c-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 28px 40px; display: grid; gap: 22px; align-content: start; }
      .opt-4 .c-console { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 16px 18px; border-radius: var(--radius-panel); border: 1px solid var(--line); background: var(--panel); }
      .opt-4 .c-console-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: color-mix(in oklab, var(--amber) 18%, transparent); color: var(--amber-deep); }
      .opt-4 .c-console h2 { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 500; }
      .opt-4 .c-console p { margin: 4px 0 0; font-size: 12.5px; color: var(--dim); max-width: 70ch; }
      .opt-4 .c-console-error { border-color: color-mix(in oklab, var(--danger) 45%, var(--line)); background: color-mix(in oklab, var(--danger) 8%, var(--panel)); }
      .opt-4 .c-console-error .c-console-icon { background: color-mix(in oklab, var(--danger) 16%, transparent); color: var(--danger); }
      .opt-4 .c-console-staged { grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 12px; border-color: color-mix(in oklab, var(--amber) 50%, var(--line)); }
      .opt-4 .c-console-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .opt-4 .c-pick-list { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
      .opt-4 .c-pick { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; padding: 10px 12px; text-align: left; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--paper); }
      .opt-4 .c-pick.is-on { border-color: color-mix(in oklab, var(--amber) 55%, var(--line)); background: color-mix(in oklab, var(--amber) 7%, var(--paper)); }
      .opt-4 .c-check { display: grid; place-items: center; width: 16px; height: 16px; margin-top: 2px; border-radius: 5px; border: 1px solid var(--line); color: var(--accent-foreground); }
      .opt-4 .c-pick.is-on .c-check { background: var(--amber); border-color: var(--amber); }
      .opt-4 .c-check svg { width: 11px; height: 11px; }
      .opt-4 .c-pick-text { display: grid; gap: 3px; }
      .opt-4 .c-pick-text b { font-size: 13px; font-weight: 500; }
      .opt-4 .c-pick-text > span { font-size: 11.5px; color: var(--dim); }
      .opt-4 .c-pick-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
      .opt-4 .c-pick-warn { display: flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 11px; color: var(--amber-deep); }
      .opt-4 .c-pick-warn svg { width: 12px; height: 12px; }
      .opt-4 .c-console-foot { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
      .opt-4 .c-scope { display: grid; gap: 6px; }
      .opt-4 .c-scope-option { display: grid; gap: 2px; padding: 6px 10px; border-radius: var(--radius-control); border: 1px solid var(--line); font-size: 12.5px; text-align: left; }
      .opt-4 .c-scope-option.is-on { border-color: var(--amber); background: color-mix(in oklab, var(--amber) 10%, transparent); }
      .opt-4 .c-scope-hint { font-size: 11px; color: var(--dim); }
      .opt-4 .c-detect { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; border: 1px dashed var(--line); font-size: 12px; color: var(--dim); }
      .opt-4 .c-detect:hover { border-color: var(--amber); color: var(--ink); }
      .opt-4 .c-detect svg { width: 13px; height: 13px; }
      .opt-4 .c-detect b { color: var(--ink); font-weight: 500; }
      .opt-4 .c-library { display: grid; gap: 10px; }
      .opt-4 .c-library-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .opt-4 .c-library-head h2 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500; }
      .opt-4 .c-library-tools { display: flex; align-items: center; gap: 10px; }
      .opt-4 .c-search { position: relative; }
      .opt-4 .c-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--dim); }
      .opt-4 .c-search input { width: 200px; padding: 7px 10px 7px 30px; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--panel); font-size: 12.5px; }
      .opt-4 .c-rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-panel); overflow: hidden; background: var(--panel); }      .opt-4 .c-row { display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent); }
      .opt-4 .c-row:last-child { border-bottom: 0; }
      .opt-4 .c-row-main { display: grid; grid-template-columns: 22px 13rem minmax(0, 1fr) auto 4.5rem; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 9px 0; text-align: left; }
      .opt-4 .c-icon { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--amber-deep); }
      .opt-4 .c-icon svg { width: 14px; height: 14px; }
      .opt-4 .c-row-name { font-family: var(--font-mono); font-size: 12px; font-weight: 500; }
      .opt-4 .c-row-desc { font-size: 12px; color: var(--dim); }
      .opt-4 .c-row-files { display: flex; gap: 4px; }
      .opt-4 .c-row-scope { text-align: right; }
      .opt-4 .c-row-tools { display: flex; align-items: center; gap: 4px; flex: none; }
      .opt-4 .c-row-editing { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 12px; background: color-mix(in oklab, var(--amber) 6%, var(--panel)); }
      .opt-4 .c-row-fields { display: grid; gap: 4px; max-width: 560px; }
      .opt-4 .c-hint { margin: 0; font-size: 11px; color: var(--dim); }
      .opt-4 .c-hint[data-error="true"] { color: var(--danger); }
      .opt-4 .c-row-actions { display: flex; align-items: center; gap: 8px; }
      .opt-4 .m-btn[disabled] { opacity: 0.5; }
      /* Narrow close-ups: the console stacks, the row drops its long columns. */
      .opt-4 .c-cu { container-type: inline-size; container-name: cu; height: 100%; }
      @container cu (max-width: 620px) {
        .opt-4 .c-console { grid-template-columns: 36px minmax(0, 1fr); }
        .opt-4 .c-console > .m-btn { grid-column: 1 / -1; justify-self: start; }
        .opt-4 .c-console-foot { flex-direction: column; align-items: stretch; }
        .opt-4 .c-row-main { grid-template-columns: 22px minmax(0, 1fr) auto; }
        .opt-4 .c-row-desc, .opt-4 .c-row-scope { display: none; }
        .opt-4 .c-row-editing { grid-template-columns: minmax(0, 1fr); }
      }
    `,
    initialState() {
      return {
        library: mock.initialSkills(),
        query: "",
        selected: null,
        editing: null,
        draft: null,
        newScope: "ade-project",
        importPhase: "pick",
        importScope: "ade-project",
        staged: null,
        picked: [],
        notice: null,
      };
    },
    mount(root, ctx) {
      ctx.root = root;
      let noticeTimer = null;
      let lastNotice = null;
      const render = () => {
        const state = ctx.getState();
        if (state.notice !== lastNotice) {
          lastNotice = state.notice;
          if (noticeTimer) clearTimeout(noticeTimer);
          noticeTimer = state.notice
            ? setTimeout(() => {
                noticeTimer = null;
                ctx.patch({ notice: null });
                render();
              }, 4500)
            : null;
        }
        window.WS.renderKeepFocus(
          root,
          `${mock.chrome()}<div class="c-wrap">${consoleHtml(ctx)}${libraryHtml(ctx)}</div>${
            state.notice
              ? `<div class="m-notice" role="status">${icons.check}<span>${esc(state.notice.text)}</span></div>`
              : ""
          }`,
        );
        ctx.report(
          `${state.library.length} skills · import console ${state.importPhase === "staged" ? "reviewing" : "idle"}`,
        );
      };
      const onClick = (e) => handleClick(e, ctx);
      const onInput = (e) => handleInput(e, ctx);
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      render();
      return {
        update() {
          render();
        },
        destroy() {
          root.removeEventListener("click", onClick);
          root.removeEventListener("input", onInput);
          if (noticeTimer) clearTimeout(noticeTimer);
        },
      };
    },
    closeups: [
      {
        label: "Import console",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () =>
            window.WS.renderKeepFocus(root, `<div class="c-cu">${consoleHtml(ctx)}</div>`);
          render();
          return {
            update: render,
            destroy() {
              root.removeEventListener("click", onClick);
            },
          };
        },
      },
      {
        label: "Library row",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () => {
            const state = ctx.getState();
            window.WS.renderKeepFocus(
              root,
              `<div class="c-cu" style="padding:0"><ul class="c-rows" style="margin:14px">${state.library.map((s) => libraryRowHtml(s, state)).join("")}</ul></div>`,
            );
          };
          render();
          return {
            update: render,
            destroy() {
              root.removeEventListener("click", onClick);
            },
          };
        },
      },
    ],
  });
})();
