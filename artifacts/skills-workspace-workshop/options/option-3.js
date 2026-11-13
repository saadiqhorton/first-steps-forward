/* Option 3 — Table + inspector.
 * A dense table for the whole library, with a right-hand inspector that edits
 * the selected skill in place. Import stages inline above the table. */
(function () {
  "use strict";

  const { icons, mock } = window.WS;

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "ade-project", label: "This project" },
    { id: "ade-user", label: "My ADE" },
    { id: "detected", label: "Found" },
  ];

  const scopeLabel = (scope) =>
    scope === "ade-project"
      ? "This project"
      : scope === "ade-user"
        ? "My ADE"
        : "Found";

  function rowHtml(skill, state, compact = false) {
    const kinds = mock.bundledKinds(skill);
    const cells = `<div class="t-cell-name">
        <span class="t-name">${esc(skill.name)}</span>
        ${skill.fresh ? `<span class="m-pill" data-tone="new">new</span>` : ""}
        ${(skill.warnings || []).length ? `<span class="m-pill" data-tone="warn">check</span>` : ""}
      </div>`;
    const desc = `<div class="t-desc">${esc(skill.description)}</div>`;
    const files = `<div class="t-cell-files">${
      kinds.length
        ? kinds.map((k) => `<span class="m-pill">${k.count} ${esc(k.label.toLowerCase())}</span>`).join("")
        : `<span class="m-label-mono">SKILL.md</span>`
    }</div>`;
    return `<tr class="t-row${state.selected === skill.id ? " is-on" : ""}" data-act="select" data-id="${esc(skill.id)}" data-focus="row-${esc(skill.id)}" data-scope="${esc(skill.scope)}" data-name="${esc(skill.name.toLowerCase())}" tabindex="0" role="button" aria-pressed="${state.selected === skill.id}">
      <td>${cells}</td>
      <td>${desc}</td>
      <td>${files}</td>
      ${
        compact
          ? ""
          : `<td><span class="m-label-mono">${esc(scopeLabel(skill.scope))}</span></td>
             <td><span class="m-label-mono">${esc(skill.updated)}</span></td>`
      }
    </tr>`;
  }

  function importBarHtml(ctx) {
    const state = ctx.getState();
    if (state.importPhase === "closed") return "";
    const pkg = state.staged || mock.packages[state.packageKey];
    if (state.importPhase === "pick") {
      return `<div class="t-import t-import-pick">
        <button type="button" class="t-drop" data-act="pick-file" data-focus="pick-file">
          ${icons.upload}
          <b>Choose a package</b>
          <span>a .skill file, or a .zip that holds skills</span>
        </button>
        <button type="button" class="m-icon-btn t-import-close" data-act="cancel-import" aria-label="Cancel import">${icons.x}</button>
      </div>`;
    }
    if (state.importPhase === "error") {
      return `<div class="t-import t-import-error">
        ${icons.alert}
        <div class="min-w-0">
          <b>${esc(pkg.fileName)}</b>
          <p>${esc(pkg.error)}</p>
        </div>
        <button type="button" class="m-btn-quiet m-btn" data-act="pick-file">Choose another file</button>
      </div>`;
    }
    return `<div class="t-import">
      <div class="t-import-head">
        <b>${esc(pkg.fileName)}</b>
        <span class="m-label-mono">${esc(pkg.kind)} · ${esc(pkg.size)} · ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"}</span>
        <button type="button" class="m-icon-btn t-import-close" data-act="cancel-import" aria-label="Cancel import">${icons.x}</button>
      </div>      <div class="t-import-grid">
        ${pkg.skills
          .map(
            (s) => `<div class="t-import-item">
              <b class="m-truncate">${esc(s.name)}</b>
              <span class="m-label-mono">${s.files.length} file${s.files.length === 1 ? "" : "s"}</span>
              ${(s.warnings || []).length ? `<span class="t-import-warn">${icons.alert}${esc(s.warnings[0])}</span>` : ""}
            </div>`,
          )
          .join("")}
      </div>
      <div class="t-import-foot">
        <div class="t-import-scope">
          <span class="m-field-label">Install into</span>
          ${mock.scopes
            .map(
              (scope) =>
                `<button type="button" class="t-scope${state.importScope === scope.id ? " is-on" : ""}" data-act="scope" data-v="${scope.id}" data-focus="scope-${scope.id}">${esc(scope.path)}</button>`,
            )
            .join("")}
        </div>
        <button type="button" class="m-btn-amber m-btn" data-act="do-import" data-focus="do-import">Import ${pkg.skills.length}</button>
      </div>
    </div>`;
  }

  function inspectorHtml(ctx, preview = null) {
    const state = ctx.getState();
    const skill = state.library.find((s) => s.id === state.selected) || preview;

    if (state.creating) {
      const draft = state.draft || { name: "", description: "" };
      const nameError = mock.validateName(draft.name);
      const descError = mock.validateDescription(draft.description);
      return `<aside class="t-inspector" aria-label="New skill">
        <div class="t-inspector-head">
          <h2>New skill</h2>
          <button type="button" class="m-icon-btn" data-act="cancel-edit" aria-label="Close" data-focus="close-inspector">${icons.x}</button>
        </div>
        <div class="t-inspector-body">
          <div>
            <label class="m-field-label" for="t-name">Name</label>
            <input id="t-name" class="m-input" data-focus="t-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off">
            <p class="t-hint" data-hint="name"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens.")}</p>
          </div>
          <div>
            <label class="m-field-label" for="t-desc">Description</label>
            <textarea id="t-desc" class="m-textarea" rows="5" data-focus="t-desc" data-field="description" placeholder="Use this skill when …">${esc(draft.description)}</textarea>
            <p class="t-hint" data-hint="description"${descError ? ' data-error="true"' : ""}>${esc(descError || "Say what it does and when to use it.")}</p>
          </div>
          <div>
            <span class="m-field-label">Install into</span>
            ${mock.scopes
              .map(
                (scope) =>
                  `<button type="button" class="t-scope${state.newScope === scope.id ? " is-on" : ""}" data-act="new-scope" data-v="${scope.id}">${esc(scope.path)}</button>`,
              )
              .join("")}
          </div>
        </div>
        <div class="t-inspector-foot">
          <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="save-skill" ${nameError || descError ? "disabled" : ""}>Create skill</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
        </div>
      </aside>`;
    }

    if (!skill) {
      return `<aside class="t-inspector t-inspector-empty" aria-label="Skill details">
        <div class="t-empty">
          ${icons.sparkles}
          <p>Select a skill to edit it, or create a new one.</p>
        </div>
      </aside>`;
    }

    const draft = state.draft || { name: skill.name, description: skill.description };
    const dirty = draft.name !== skill.name || draft.description !== skill.description;
    const nameError = mock.validateName(draft.name);
    const descError = mock.validateDescription(draft.description);
    const scope = mock.scopeOf(skill);

    return `<aside class="t-inspector" aria-label="Skill details">
      <div class="t-inspector-head">
        <div class="min-w-0">
          <h2 class="m-truncate">${esc(skill.name)}</h2>
          <span class="m-label-mono m-truncate">${esc(skill.path)}</span>
        </div>
        <button type="button" class="m-icon-btn" data-act="close-inspector" aria-label="Close" data-focus="close-inspector">${icons.x}</button>
      </div>
      <div class="t-inspector-body">
        ${
          skill.owned
            ? ""
            : `<div class="t-warning">${icons.folder}<span>Found in ${esc(scope.path)} — read-only here. Copy it into ADE's own set to change it.</span></div>`
        }
        ${
          (skill.warnings || []).length
            ? `<div class="t-warning">${icons.alert}<span>${esc(skill.warnings[0])}</span></div>`
            : ""
        }
        <div>
          <label class="m-field-label" for="t-edit-name">Name</label>
          <input id="t-edit-name" class="m-input" data-focus="t-edit-name" data-field="name" value="${esc(draft.name)}" autocomplete="off">
          <p class="t-hint" data-hint="name"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens.")}</p>
        </div>
        <div>
          <label class="m-field-label" for="t-edit-desc">Description</label>
          <textarea id="t-edit-desc" class="m-textarea" rows="5" data-focus="t-edit-desc" data-field="description">${esc(draft.description)}</textarea>
          <p class="t-hint" data-hint="description"${descError ? ' data-error="true"' : ""}>${esc(descError || "This is what an agent reads to decide whether to load the skill.")}</p>
        </div>
        <div>
          <span class="m-field-label">Bundled files</span>
          <div class="t-files">
            ${
              skill.files.length
                ? skill.files.map((f) => mock.fileRow(f)).join("")
                : `<p class="t-hint">Name and description only.</p>`
            }
          </div>
          ${
            mock.bundledKinds(skill).length
              ? `<p class="t-hint">${mock
                  .bundledKinds(skill)
                  .map((k) => `${k.count} ${k.label.toLowerCase()}`)
                  .join(" · ")} — loaded only when the instructions ask for them.</p>`
              : ""
          }
        </div>
      </div>
      <div class="t-inspector-foot">
        <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="save-skill" ${dirty && !nameError && !descError && skill.owned ? "" : "disabled"}>Save</button>
        ${
          !skill.owned
            ? `<button type="button" class="m-btn-quiet m-btn" data-act="copy-to-ade" data-id="${esc(skill.id)}" data-focus="copy-skill">${icons.copy}Copy into ADE</button>`
            : state.confirmRemove === skill.id
              ? `<span class="t-confirm">Remove? <button type="button" class="t-confirm-yes" data-act="remove-yes" data-id="${esc(skill.id)}">Remove</button> <button type="button" class="t-confirm-no" data-act="remove-no">Keep</button></span>`
              : `<button type="button" class="t-danger" data-act="remove" data-id="${esc(skill.id)}">${icons.trash}Remove</button>`
        }
      </div>
    </aside>`;
  }

  function tableHtml(ctx) {
    const state = ctx.getState();
    const hidden = mock.hiddenFoundSkills(state.library, state.detectFound);
    const shown = mock
      .visibleSkills(state.library, state.detectFound)
      .filter((s) => {
        if (!mock.matchesFilter(s, state.filter)) return false;
        const term = state.query.trim().toLowerCase();
        if (!term) return true;
        return s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);
      });

    return `<div class="t-wrap">
      <div class="t-head">
        <div class="min-w-0">
          <h1 class="t-title">Skills</h1>
          <p class="t-sub">ADE's own set in <code>~/.ade/skills</code>, plus anything else you choose to show.</p>
        </div>
        <div class="t-actions">
          <button type="button" class="m-btn-quiet m-btn" data-act="open-import" data-focus="open-import">${icons.upload}Import</button>
          <button type="button" class="m-btn-amber m-btn" data-act="new" data-focus="new-skill">${icons.plus}New skill</button>
        </div>
      </div>
      <div class="t-toolbar">
        <div class="t-search">
          ${icons.search}
          <input type="search" value="${esc(state.query)}" placeholder="Search skills" aria-label="Search skills" data-focus="t-search" data-field="query">
        </div>
        <div class="t-filters" role="group" aria-label="Filter skills">
          ${FILTERS.map(
            (f) =>
              `<button type="button" class="t-filter${state.filter === f.id ? " is-on" : ""}" data-act="filter" data-v="${esc(f.id)}" data-focus="filter-${esc(f.id)}">${f.label}</button>`,
          ).join("")}
        </div>
        ${
          hidden.length
            ? `<button type="button" class="t-detect" data-act="show-project" data-focus="show-project">${icons.folder}<span>${hidden.length} found in <code>.agents/skills</code></span><b>Show</b></button>`
            : ""
        }
      </div>
      ${importBarHtml(ctx)}
      <table class="t-table">
        <thead>
          <tr><th>Skill</th><th>Description</th><th>Bundles</th><th>Scope</th><th>Updated</th></tr>
        </thead>
        <tbody>
          ${
            shown.length
              ? shown.map((s) => rowHtml(s, state)).join("")
              : `<tr><td colspan="5"><p class="m-empty">No skills match this search.</p></td></tr>`
          }
        </tbody>
      </table>
    </div>`;
  }

  function handleClick(e, ctx) {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const state = ctx.getState();

    if (act === "select") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      ctx.setState({
        selected: button.dataset.id,
        creating: false,
        draft: skill ? { name: skill.name, description: skill.description } : null,
      });
      return;
    }
    if (act === "close-inspector") {
      ctx.setState({ selected: null, creating: false, draft: null, confirmRemove: null });
      return;
    }
    if (act === "open-import") {
      ctx.setState({ importPhase: "pick", staged: null });
      return;
    }
    if (act === "pick-file") {
      const pkg = mock.packages[state.packageKey];
      ctx.setState({ staged: pkg, importPhase: pkg.error ? "error" : "staged" });
      return;
    }
    if (act === "cancel-import") {
      ctx.setState({ importPhase: "closed", staged: null });
      return;
    }
    if (act === "scope") {
      ctx.setState({ importScope: button.dataset.v });
      return;
    }
    if (act === "new-scope") {
      ctx.setState({ newScope: button.dataset.v });
      return;
    }
    if (act === "do-import") {
      const pkg = state.staged || mock.packages[state.packageKey];
      if (!pkg || pkg.error) return;
      ctx.setState({
        library: mock.importInto(state.library, pkg, state.importScope),
        importPhase: "closed",
        staged: null,
        selected: `imported-${pkg.skills[0].folder}`,
        notice: { text: `Imported ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"}` },
      });
      return;
    }
    if (act === "new") {
      ctx.setState({
        creating: true,
        selected: null,
        draft: { name: "", description: "" },
        importPhase: "closed",
      });
      return;
    }
    if (act === "cancel-edit") {
      ctx.setState({ creating: false, draft: null });
      return;
    }
    if (act === "save") {
      const draft = state.draft || { name: "", description: "" };
      const name = draft.name.trim();
      if (mock.validateName(name) || mock.validateDescription(draft.description)) return;
      if (state.creating) {
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
          creating: false,
          draft: null,
          selected: skill.id,
          notice: { text: `Created “${name}”` },
        });
        return;
      }
      const library = state.library.map((s) =>
        s.id === state.selected
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
      ctx.setState({ library, draft: null, notice: { text: `Saved “${name}”` } });
      return;
    }
    if (act === "remove") {
      ctx.setState({ confirmRemove: button.dataset.id });
      return;
    }
    if (act === "remove-no") {
      ctx.setState({ confirmRemove: null });
      return;
    }
    if (act === "remove-yes") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      ctx.setState({
        library: state.library.filter((s) => s.id !== button.dataset.id),
        selected: null,
        confirmRemove: null,
        draft: null,
        notice: { text: `Removed “${skill ? skill.name : "skill"}”` },
      });
      return;
    }
    if (act === "filter") {
      ctx.setState({ filter: button.dataset.v });
      return;
    }
    if (act === "show-project") {
      ctx.setState({ detectFound: true });
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
        selected: copy.id,
        draft: { name: copy.name, description: copy.description },
        notice: { text: `Copied “${skill.name}” into ~/.ade/skills` },
      });
    }
  }

  function handleInput(e, ctx) {
    const field = e.target.dataset.field;
    if (!field) return;
    if (field === "query") {
      ctx.patch({ query: e.target.value });
      const state = ctx.getState();
      const term = state.query.trim().toLowerCase();
      ctx.root.querySelectorAll(".t-row").forEach((row) => {
        const ok =
          mock.matchesFilter({ scope: row.dataset.scope }, state.filter) &&
          (!term || (row.dataset.name || "").includes(term));
        row.style.display = ok ? "" : "none";
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
          : "This is what an agent reads to decide whether to load the skill.");
      if (hint.hasAttribute("data-error")) delete hint.dataset.error;
    }
  }

  WS.register({
    id: 3,
    name: "Table + inspector",
    tradeoff:
      "A table compares many skills at once and the inspector edits in place, but descriptions get squeezed and cards lose their shape.",
    notes: [
      "One row per skill: name, description, what it bundles, scope, and when it changed. Sorting and filtering stay in the toolbar, where a table can afford them.",
      "Selecting a row opens an inspector on the right. The fields are editable right there, so editing never leaves the list you were reading.",
      "Import stages inline above the table instead of in a dialog: the found skills, their file counts, and where they will land, all in one strip.",
      "The Bundles column counts what a skill carries — references, scripts, assets — because that is the difference between a one-file skill and a package.",
      "The name and description fields validate against the Agent Skills rules while you type, so a skill that would not load never reaches the disk.",
    ],
    css: `
      .opt-3 .t-split { position: relative; display: flex; flex: 1; min-height: 0; }
      .opt-3 .t-wrap { flex: 1; min-width: 0; overflow-y: auto; padding: 24px 28px 40px; }
      .opt-3 .t-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
      .opt-3 .t-title { margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 500; letter-spacing: -0.03em; }
      .opt-3 .t-sub { margin: 6px 0 0; font-size: 13px; color: var(--dim); }
      .opt-3 .t-actions { display: flex; gap: 8px; flex: none; }
      .opt-3 .t-toolbar { display: flex; align-items: center; gap: 16px; margin-top: 18px; flex-wrap: wrap; }
      .opt-3 .t-search { position: relative; flex: 1; min-width: 180px; max-width: 320px; }
      .opt-3 .t-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--dim); }
      .opt-3 .t-search input { width: 100%; padding: 7px 10px 7px 30px; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--panel); font-size: 13px; }
      .opt-3 .t-filters { display: flex; gap: 4px; }
      .opt-3 .t-filter { padding: 5px 10px; border-radius: 8px; font-size: 12.5px; color: var(--dim); }
      .opt-3 .t-filter:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-3 .t-filter.is-on { background: color-mix(in oklab, var(--ink) 8%, transparent); color: var(--ink); font-weight: 500; }
      .opt-3 .t-table { width: 100%; margin-top: 14px; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
      .opt-3 .t-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-family: var(--font-mono); font-size: 10.5px; font-weight: 400; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
      .opt-3 .t-table th:nth-child(1), .opt-3 .t-table td:nth-child(1) { width: 12.5rem; }
      .opt-3 .t-table th:nth-child(3), .opt-3 .t-table td:nth-child(3) { width: 8.5rem; }
      .opt-3 .t-table th:nth-child(4), .opt-3 .t-table td:nth-child(4) { width: 5rem; }
      .opt-3 .t-table th:nth-child(5), .opt-3 .t-table td:nth-child(5) { width: 6.5rem; }
      .opt-3 .t-table-compact th:nth-child(1), .opt-3 .t-table-compact td:nth-child(1) { width: 8rem; }
      .opt-3 .t-table-compact th:nth-child(3), .opt-3 .t-table-compact td:nth-child(3) { width: 6rem; }
      .opt-3 .t-row { cursor: pointer; }
      .opt-3 .t-row td { padding: 9px 10px; border-bottom: 1px solid color-mix(in oklab, var(--line) 60%, transparent); vertical-align: middle; }
      .opt-3 .t-row:hover td { background: color-mix(in oklab, var(--ink) 4%, transparent); }
      .opt-3 .t-row.is-on td { background: color-mix(in oklab, var(--amber) 12%, transparent); }
      .opt-3 .t-row:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }
      .opt-3 .t-cell-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .opt-3 .t-name { font-family: var(--font-mono); font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opt-3 .m-pill[data-tone="warn"] { color: var(--amber-deep); border-color: color-mix(in oklab, var(--amber) 45%, var(--line)); }
      .opt-3 .t-desc { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); }
      .opt-3 .t-cell-files { display: flex; gap: 4px; overflow: hidden; }
      .opt-3 .t-detect { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; padding: 6px 10px; border-radius: 8px; border: 1px dashed var(--line); font-size: 12px; color: var(--dim); }
      .opt-3 .t-detect:hover { border-color: var(--amber); color: var(--ink); }
      .opt-3 .t-detect svg { width: 14px; height: 14px; }
      .opt-3 .t-detect b { color: var(--ink); font-weight: 500; }
      .opt-3 .t-import { margin-top: 14px; padding: 12px 14px; border: 1px solid var(--amber); border-radius: var(--radius-panel); background: color-mix(in oklab, var(--amber) 8%, var(--panel)); display: grid; gap: 10px; }
      .opt-3 .t-import-pick { grid-template-columns: minmax(0, 1fr) auto; align-items: start; border-style: dashed; }
      .opt-3 .t-drop { display: grid; justify-items: center; gap: 3px; padding: 14px; border-radius: var(--radius-control); color: var(--dim); }
      .opt-3 .t-drop:hover { color: var(--ink); }
      .opt-3 .t-drop b { font-size: 13px; color: var(--ink); font-weight: 500; }
      .opt-3 .t-drop span { font-size: 12px; }
      .opt-3 .t-drop svg { width: 20px; height: 20px; }
      .opt-3 .t-import-error { grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; border-color: color-mix(in oklab, var(--danger) 45%, var(--line)); background: color-mix(in oklab, var(--danger) 10%, var(--panel)); color: var(--danger); }
      .opt-3 .t-import-error p { margin: 3px 0 0; font-size: 12px; }
      .opt-3 .t-import-head { display: flex; align-items: baseline; gap: 10px; }
      .opt-3 .t-import-head b { font-size: 13px; }
      .opt-3 .t-import-close { margin-left: auto; }
      .opt-3 .t-import-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }
      .opt-3 .t-import-item { display: grid; gap: 3px; padding: 8px 10px; border-radius: var(--radius-control); background: var(--panel); border: 1px solid var(--line); }
      .opt-3 .t-import-item b { font-size: 12.5px; }
      .opt-3 .t-import-warn { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--amber-deep); }
      .opt-3 .t-import-warn svg { width: 12px; height: 12px; }
      .opt-3 .t-import-foot { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
      .opt-3 .t-import-scope { display: flex; align-items: center; gap: 6px; }
      .opt-3 .t-import-scope .m-field-label { margin: 0; }
      .opt-3 .t-scope { padding: 5px 9px; border-radius: 8px; border: 1px solid var(--line); font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-3 .t-scope.is-on { border-color: var(--amber); color: var(--ink); background: color-mix(in oklab, var(--amber) 12%, transparent); }
      .opt-3 .t-inspector { width: 360px; flex: none; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); }
      .opt-3 .t-inspector-empty { align-items: center; justify-content: center; }
      .opt-3 .t-empty { display: grid; justify-items: center; gap: 8px; padding: 24px; text-align: center; color: var(--dim); font-size: 12.5px; }
      .opt-3 .t-empty p { margin: 0; max-width: 22ch; }
      .opt-3 .t-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 14px 10px; border-bottom: 1px solid var(--line); }
      .opt-3 .t-inspector-head h2 { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 500; }
      .opt-3 .t-inspector-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: grid; gap: 14px; align-content: start; }
      .opt-3 .t-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--dim); }
      .opt-3 .t-hint[data-error="true"] { color: var(--danger); }
      .opt-3 .t-warning { display: flex; gap: 8px; padding: 8px 10px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--amber) 16%, transparent); color: var(--amber-deep); font-size: 12px; }
      .opt-3 .t-files { border: 1px solid var(--line); border-radius: var(--radius-control); overflow: hidden; }
      .opt-3 .m-file-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12px; }
      .opt-3 .m-file-row + .m-file-row { border-top: 1px solid var(--line); }
      .opt-3 .m-file-icon { color: var(--dim); display: grid; place-items: center; }
      .opt-3 .m-file-icon svg { width: 14px; height: 14px; }
      .opt-3 .m-file-name { font-family: var(--font-mono); font-size: 11.5px; }
      .opt-3 .t-inspector-foot { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line); }
      .opt-3 .m-btn[disabled] { opacity: 0.5; }
      .opt-3 .t-danger { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: var(--radius-control); font-size: 13px; color: var(--danger); }
      .opt-3 .t-danger:hover { background: color-mix(in oklab, var(--danger) 12%, transparent); }
      .opt-3 .t-confirm { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); }
      .opt-3 .t-confirm-yes { padding: 4px 8px; border-radius: 6px; background: var(--danger); color: var(--paper); font-size: 12px; }
      .opt-3 .t-confirm-no { padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--dim); text-decoration: underline; }
    `,
    initialState() {
      return {
        library: mock.initialSkills(),
        query: "",
        filter: "all",
        selected: null,
        creating: false,
        confirmRemove: null,
        draft: null,
        newScope: "ade-project",
        importOpen: false,
        importPhase: "closed",
        importScope: "ade-project",
        staged: null,
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
          `${mock.chrome()}<div class="t-split"><div class="t-wrap">${tableHtml(ctx)}</div>${inspectorHtml(ctx)}</div>${
            state.notice
              ? `<div class="m-notice" role="status">${icons.check}<span>${esc(state.notice.text)}</span></div>`
              : ""
          }`,
        );
        ctx.report(`${state.library.length} skills · ${state.selected ? "1 selected" : "none selected"}`);
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
        label: "Library table",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () => {
            const state = ctx.getState();
            window.WS.renderKeepFocus(
              root,
              `<div style="padding:14px"><table class="t-table t-table-compact"><thead><tr><th>Skill</th><th>Description</th><th>Bundles</th></tr></thead><tbody>${state.library.map((s) => rowHtml(s, state, true)).join("")}</tbody></table></div>`,
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
      {
        label: "Inspector",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () =>
            window.WS.renderKeepFocus(root, inspectorHtml(ctx, ctx.getState().library[0]));
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
