/* Option 2 — Explorer split.
 * A Files-style sidebar lists the skills; the right pane shows one skill with
 * tabs for its overview, its bundled files, and its SKILL.md body. */
(function () {
  "use strict";

  const { icons, mock } = window.WS;

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const GROUPS = [
    { id: "ade-project", label: "This project", path: ".ade/skills" },
    { id: "ade-user", label: "My ADE", path: "~/.ade/skills" },
    { id: "detected-project", label: "Found in the project", path: ".agents/skills" },
    { id: "detected-user", label: "Found in your home", path: "~/.agents/skills" },
  ];

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "body", label: "SKILL.md" },
  ];

  function sidebarHtml(ctx) {
    const state = ctx.getState();
    const term = state.query.trim().toLowerCase();
    const hidden = mock.hiddenFoundSkills(state.library, state.detectFound);
    const groups = GROUPS.map((group) => {
      if (group.id.startsWith("detected") && !state.detectFound) return "";
      const skills = mock
        .visibleSkills(state.library, state.detectFound)
        .filter(
          (s) =>
            s.scope === group.id &&
            (!term ||
              s.name.toLowerCase().includes(term) ||
              s.description.toLowerCase().includes(term)),
        );
      if (!skills.length) return "";
      return `<div class="x-group">
        <div class="x-group-head">
          <span class="m-label-mono">${group.label}</span>
          <span class="m-label-mono">${group.path}</span>
        </div>
        ${skills
          .map(
            (
              s,
            ) => `<button type="button" class="x-row${state.selected === s.id ? " is-on" : ""}" data-act="select" data-id="${esc(s.id)}" data-focus="row-${esc(s.id)}" data-name="${esc(s.name.toLowerCase())}">
              <span class="x-row-icon" aria-hidden="true">${icons.sparkles}</span>
              <span class="x-row-text">
                <span class="x-row-name m-truncate">${esc(s.name)}</span>
                <span class="x-row-meta m-label-mono">${s.files.length} ${s.files.length === 1 ? "file" : "files"}</span>
              </span>
            </button>`,
          )
          .join("")}
      </div>`;
    }).join("");

    const pkg = state.staged || mock.packages[state.packageKey];
    const broken = state.importPhase === "error";

    return `<aside class="x-side" aria-label="Skills">
      <div class="x-side-head">
        <span class="label-mono">Skills</span>
        <span class="m-label-mono">${state.library.length}</span>
      </div>
      <div class="x-side-search">
        ${icons.search}
        <input type="search" value="${esc(state.query)}" placeholder="Find a skill" aria-label="Find a skill" data-focus="x-search" data-field="query">
      </div>
      <div class="x-side-list">
        ${groups || `<p class="m-empty">No skills yet.</p>`}
        ${
          hidden.length
            ? `<button type="button" class="x-hidden" data-act="show-project" data-focus="show-project">
                ${icons.folder}
                <span>${hidden.length} found in <code>.agents/skills</code></span>
                <span class="m-label-mono">Show</span>
              </button>`
            : ""
        }
      </div>
      <div class="x-side-foot">
        ${
          broken
            ? `<div class="x-error">${icons.alert}<p>${esc(pkg.error)}</p></div>`
            : state.importPhase === "staged"
              ? `<div class="x-staged">
                   <div class="m-label-mono">${esc(pkg.fileName)} · ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"}</div>
                   ${pkg.skills.map((s) => `<div class="x-staged-row m-truncate">${esc(s.name)}</div>`).join("")}
                   <div class="x-scope">
                     ${mock.scopes
                       .map(
                         (scope) =>
                           `<button type="button" class="x-scope-option${state.importScope === scope.id ? " is-on" : ""}" data-act="scope" data-v="${scope.id}" data-focus="scope-${scope.id}" title="${esc(scope.hint)}">${esc(scope.path)}</button>`,
                       )
                       .join("")}
                   </div>
                   <div class="x-staged-actions">
                     <button type="button" class="m-btn-amber m-btn" data-act="do-import" data-focus="do-import">Import</button>
                     <button type="button" class="m-btn-quiet m-btn" data-act="cancel-import">Cancel</button>
                   </div>
                 </div>`
              : `<button type="button" class="x-drop" data-act="pick-file" data-focus="pick-file">${icons.upload}<span>Drop a .skill or .zip</span></button>`
        }
      </div>
    </aside>`;
  }

  function editorHtml(ctx) {
    const state = ctx.getState();
    const draft = state.draft || { name: "", description: "" };
    const nameError = mock.validateName(draft.name);
    const descError = mock.validateDescription(draft.description);
    return `<form class="x-editor" onsubmit="return false">
      <div class="x-editor-head">
        <h2>${state.creating ? "New skill" : "Edit skill"}</h2>
        <p>${state.creating ? "A name and a description is enough to start." : esc(state.draftPath || "")}</p>
      </div>
      <div class="x-editor-body">
        <div>
          <label class="m-field-label" for="x-name">Name</label>
          <input id="x-name" class="m-input" data-focus="x-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off">
          <p class="x-hint" data-hint="name"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens. The folder name follows it.")}</p>
        </div>
        <div>
          <label class="m-field-label" for="x-desc">Description</label>
          <textarea id="x-desc" class="m-textarea" rows="3" data-focus="x-desc" data-field="description" placeholder="Use this skill when …">${esc(draft.description)}</textarea>
          <p class="x-hint" data-hint="description"${descError ? ' data-error="true"' : ""}>${esc(descError || `Say what it does and when to use it. ${(draft.description || "").length}/1024 characters.`)}</p>
        </div>
        ${
          state.creating
            ? `<p class="x-hint">Bundled folders can be added later, when the skill needs them.</p>`
            : `<div>
                 <label class="m-field-label" for="x-body">Instructions (SKILL.md)</label>
                 <textarea id="x-body" class="m-textarea m-textarea-mono" rows="10" data-focus="x-body" data-field="body">${esc(state.draftBody || "")}</textarea>
               </div>`
        }
      </div>
      <div class="x-editor-foot">
        <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="save-skill" ${nameError || descError ? "disabled" : ""}>${state.creating ? "Create skill" : "Save changes"}</button>
        <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
      </div>
    </form>`;
  }

  function mainHtml(ctx) {
    const state = ctx.getState();
    const skill = state.library.find((s) => s.id === state.selected);

    if (state.editing) return editorHtml(ctx);

    if (!skill) {
      return `<div class="x-empty">
        <span class="x-empty-icon" aria-hidden="true">${icons.sparkles}</span>
        <h2>No skill selected</h2>
        <p>Pick a skill on the left to see its files, or import a package.</p>
        <div class="x-empty-actions">
          <button type="button" class="m-btn-amber m-btn" data-act="new" data-focus="new-skill">${icons.plus}New skill</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="pick-file">${icons.upload}Import</button>
        </div>
      </div>`;
    }

    const scope = mock.scopeOf(skill);
    const body =
      state.tab === "overview"
        ? `<div class="x-pane">
             <p class="x-desc">${esc(skill.description)}</p>
             ${skill.owned ? "" : `<div class="x-warning">${icons.folder}<span>Found in ${esc(scope.path)} — read-only here. Copy it into ADE's own set to change it.</span></div>`}
             ${(skill.warnings || []).length ? `<div class="x-warning">${icons.alert}<span>${esc(skill.warnings[0])}</span></div>` : ""}
             <dl class="x-meta">
               <div><dt class="m-label-mono">Scope</dt><dd>${esc(scope.label)}</dd></div>
               <div><dt class="m-label-mono">Path</dt><dd class="m-mono">${esc(skill.path)}</dd></div>
               <div><dt class="m-label-mono">Bundles</dt><dd>${
                 mock
                   .bundledKinds(skill)
                   .map((k) => `${k.count} ${k.label.toLowerCase()}`)
                   .join(", ") || "SKILL.md only"
               }</dd></div>
               <div><dt class="m-label-mono">Updated</dt><dd>${esc(skill.updated)}</dd></div>
             </dl>
           </div>`
        : state.tab === "files"
          ? `<div class="x-pane">
               ${
                 skill.files.length
                   ? `<div class="x-files">${skill.files.map((f) => mock.fileRow(f)).join("")}</div>`
                   : `<p class="m-empty">This skill has no files yet — name and description only.</p>`
               }
             </div>`
          : `<div class="x-pane"><pre class="x-body">${esc(mock.bodyFor(skill))}</pre></div>`;

    return `<div class="x-main-head">
        <div class="min-w-0">
          <h2 class="x-title m-truncate">${esc(skill.name)}</h2>
          <p class="x-sub m-truncate">${esc(skill.path)}</p>
        </div>
        <div class="x-main-actions">
          <button type="button" class="m-btn-quiet m-btn" data-act="pick-file" data-focus="import-btn">${icons.upload}Import</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="edit" data-focus="edit-skill" ${skill.owned ? "" : "disabled"}>${icons.pencil}Edit</button>
          ${
            skill.owned
              ? `<button type="button" class="x-danger" data-act="remove" data-id="${esc(skill.id)}" aria-label="Remove ${esc(skill.name)}" data-focus="remove-skill">${icons.trash}</button>`
              : `<button type="button" class="m-btn-quiet m-btn" data-act="copy-to-ade" data-id="${esc(skill.id)}" data-focus="copy-skill">${icons.copy}Copy into ADE</button>`
          }
        </div>
      </div>
      <div class="x-tabs" role="tablist">
        ${TABS.map(
          (t) =>
            `<button type="button" role="tab" aria-selected="${state.tab === t.id}" class="x-tab${state.tab === t.id ? " is-on" : ""}" data-act="tab" data-v="${t.id}" data-focus="tab-${t.id}">${t.label}${t.id === "files" ? ` <span class="m-label-mono">${skill.files.length}</span>` : ""}</button>`,
        ).join("")}
      </div>
      ${body}`;
  }

  function handleClick(e, ctx) {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const state = ctx.getState();

    if (act === "select") {
      ctx.setState({ selected: button.dataset.id, editing: false, tab: "overview" });
      return;
    }
    if (act === "tab") {
      ctx.setState({ tab: button.dataset.v });
      return;
    }
    if (act === "pick-file") {
      const pkg = mock.packages[state.packageKey];
      ctx.setState({ staged: pkg, importPhase: pkg.error ? "error" : "staged" });
      return;
    }
    if (act === "scope") {
      ctx.setState({ importScope: button.dataset.v });
      return;
    }
    if (act === "cancel-import") {
      ctx.setState({ importPhase: "pick", staged: null });
      return;
    }
    if (act === "show-project") {
      ctx.setState({ detectFound: true });
      return;
    }
    if (act === "do-import") {
      const pkg = state.staged || mock.packages[state.packageKey];
      if (!pkg || pkg.error) return;
      ctx.setState({
        library: mock.importInto(state.library, pkg, state.importScope),
        importPhase: "pick",
        staged: null,
        selected: `imported-${pkg.skills[0].folder}`,
        notice: {
          text: `Imported ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"}`,
        },
      });
      return;
    }
    if (act === "edit") {
      const skill = state.library.find((s) => s.id === state.selected);
      if (!skill || !skill.owned) return;
      ctx.setState({
        editing: true,
        draft: { name: skill.name, description: skill.description },
        draftPath: skill.path,
        draftBody: mock.bodyFor(skill),
      });
      return;
    }
    if (act === "new") {
      ctx.setState({
        editing: true,
        creating: true,
        draft: { name: "", description: "" },
        draftPath: mock.pathFor(state.newScope || "ade-project", "my-skill"),
        draftBody: "",
      });
      return;
    }
    if (act === "cancel-edit") {
      ctx.setState({ editing: false, creating: false, draft: null });
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
          editing: false,
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
              body: state.draftBody ?? s.body,
              updated: "just now",
            }
          : s,
      );
      ctx.setState({
        library,
        editing: false,
        draft: null,
        notice: { text: `Saved “${name}”` },
      });
      return;
    }
    if (act === "remove") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill || !skill.owned) return;
      ctx.setState({
        library: state.library.filter((s) => s.id !== skill.id),
        selected: null,
        notice: { text: `Removed “${skill.name}”` },
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
        selected: copy.id,
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
      ctx.root.querySelectorAll(".x-row").forEach((row) => {
        const name = (row.dataset.name || "").toLowerCase();
        row.style.display = !term || name.includes(term) ? "" : "none";
      });
      return;
    }
    if (field === "body") {
      ctx.patch({ draftBody: e.target.value });
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
          ? "Lowercase letters, numbers and hyphens. The folder name follows it."
          : `Say what it does and when to use it. ${draft.description.length}/1024 characters.`);
      if (hint.hasAttribute("data-error")) delete hint.dataset.error;
    }
    const save = ctx.root.querySelector('[data-act="save"]');
    if (save) {
      save.disabled = Boolean(
        mock.validateName(draft.name) || mock.validateDescription(draft.description),
      );
    }
  }

  WS.register({
    id: 2,
    name: "Explorer split",
    tradeoff:
      "A Files-style sidebar keeps the library one click away, but the narrow list is the weakest place to read descriptions.",
    notes: [
      "The left rail lists skills by scope — this project (<code>.agents/skills/</code>) and your home (<code>~/.agents/skills/</code>) — which is exactly where a client discovers them.",
      "The right pane holds one skill with three tabs — Overview, Files, SKILL.md — so bundled folders are a tab away instead of crowding the list.",
      "Import lives in the sidebar footer as a drop target. Staging a package replaces the drop target with what was found, so nothing is imported unseen.",
      "The groups follow where a skill actually lives: ADE's own set in <code>~/.ade/skills</code>, the project's <code>.agents/skills</code>, and <code>~/.agents/skills</code>. Only ADE's group is editable; the others are shown read-only, with a copy-into-ADE action.",
      "In the real code this reuses the Files page's panel split, its tab strip, and the same editor file for reading and writing a skill.",
    ],
    css: `
      .opt-2 .x-split { display: flex; flex: 1; min-height: 0; }
      .opt-2 .x-side { display: flex; flex-direction: column; width: 250px; flex: none; min-height: 0; border-right: 1px solid var(--line); background: var(--panel); }
      .opt-2 .x-side-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 8px; }
      .opt-2 .x-side-search { position: relative; margin: 0 10px 8px; }
      .opt-2 .x-side-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--dim); }
      .opt-2 .x-side-search input { width: 100%; padding: 6px 8px 6px 28px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); font-size: 12.5px; }
      .opt-2 .x-side-list { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 8px; }
      .opt-2 .x-group { margin-bottom: 10px; }
      .opt-2 .x-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 6px 14px 4px; }
      .opt-2 .x-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; margin: 0 6px; border-radius: 10px; text-align: left; }
      .opt-2 .x-row:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); }
      .opt-2 .x-row.is-on { background: color-mix(in oklab, var(--amber) 14%, transparent); }
      .opt-2 .x-row-icon { display: grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 6px; color: var(--amber-deep); }
      .opt-2 .x-row-icon svg { width: 14px; height: 14px; }
      .opt-2 .x-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
      .opt-2 .x-row-name { font-size: 12.5px; }
      .opt-2 .x-row-meta { font-size: 10px; }
      .opt-2 .x-hidden { display: flex; align-items: center; gap: 8px; width: calc(100% - 12px); margin: 6px; padding: 7px 8px; border-radius: 8px; font-size: 11.5px; color: var(--dim); text-align: left; }
      .opt-2 .x-hidden:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-2 .x-hidden svg { width: 14px; height: 14px; }
      .opt-2 .x-hidden .m-label-mono { margin-left: auto; }
      .opt-2 .x-side-foot { flex: none; padding: 10px; border-top: 1px solid var(--line); }
      .opt-2 .x-drop { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px; border-radius: 10px; border: 1px dashed color-mix(in oklab, var(--ink) 26%, var(--line)); font-size: 12px; color: var(--dim); }
      .opt-2 .x-drop:hover { border-color: var(--amber); color: var(--ink); }
      .opt-2 .x-staged { display: grid; gap: 6px; }
      .opt-2 .x-staged-row { padding: 5px 8px; border-radius: 8px; background: color-mix(in oklab, var(--ink) 5%, transparent); font-size: 12px; }
      .opt-2 .x-scope { display: flex; gap: 4px; }
      .opt-2 .x-scope-option { flex: 1; padding: 5px 6px; border-radius: 7px; border: 1px solid var(--line); font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
      .opt-2 .x-scope-option.is-on { border-color: var(--amber); color: var(--ink); }
      .opt-2 .x-staged-actions { display: flex; gap: 6px; margin-top: 2px; }
      .opt-2 .x-error { display: grid; gap: 6px; color: var(--danger); font-size: 11.5px; }
      .opt-2 .x-error p { margin: 0; }
      .opt-2 .x-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--paper); }
      .opt-2 .x-main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 20px 12px; }
      .opt-2 .x-title { margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 500; }
      .opt-2 .x-sub { margin: 3px 0 0; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-2 .x-main-actions { display: flex; align-items: center; gap: 6px; flex: none; }
      .opt-2 .x-danger { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-control); color: var(--dim); }
      .opt-2 .x-danger:hover { color: var(--danger); background: color-mix(in oklab, var(--danger) 12%, transparent); }
      .opt-2 .x-tabs { display: flex; gap: 2px; padding: 0 20px; border-bottom: 1px solid var(--line); }
      .opt-2 .x-tab { padding: 7px 10px; font-size: 12.5px; color: var(--dim); border-bottom: 2px solid transparent; }
      .opt-2 .x-tab.is-on { color: var(--ink); border-bottom-color: var(--amber); }
      .opt-2 .x-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; }
      .opt-2 .x-desc { margin: 0 0 16px; font-size: 13px; line-height: 1.6; max-width: 60ch; }
      .opt-2 .x-warning { display: flex; gap: 8px; padding: 8px 10px; margin-bottom: 14px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--amber) 16%, transparent); color: var(--amber-deep); font-size: 12px; max-width: 60ch; }
      .opt-2 .x-meta { display: grid; gap: 10px; margin: 0; max-width: 460px; }
      .opt-2 .x-meta > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; align-items: baseline; }
      .opt-2 .x-meta dd { margin: 0; font-size: 12.5px; }
      .opt-2 .m-mono { font-family: var(--font-mono); font-size: 11.5px; }
      .opt-2 .x-files { border: 1px solid var(--line); border-radius: var(--radius-control); overflow: hidden; max-width: 520px; background: var(--panel); }
      .opt-2 .m-file-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; }
      .opt-2 .m-file-row + .m-file-row { border-top: 1px solid var(--line); }
      .opt-2 .m-file-icon { color: var(--dim); display: grid; place-items: center; }
      .opt-2 .m-file-icon svg { width: 14px; height: 14px; }
      .opt-2 .m-file-name { font-family: var(--font-mono); font-size: 11.5px; }
      .opt-2 .x-body { margin: 0; padding: 14px; border-radius: var(--radius-control); background: var(--deck); color: var(--deck-foreground); font-family: var(--font-mono); font-size: 11.5px; line-height: 1.65; white-space: pre-wrap; overflow: auto; }
      .opt-2 .x-empty { flex: 1; display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; padding: 40px; }
      .opt-2 .x-empty-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: color-mix(in oklab, var(--amber) 16%, transparent); color: var(--amber-deep); }
      .opt-2 .x-empty h2 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500; }
      .opt-2 .x-empty p { margin: 0; font-size: 12.5px; color: var(--dim); }
      .opt-2 .x-empty-actions { display: flex; gap: 8px; margin-top: 6px; }
      .opt-2 .x-editor { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .opt-2 .x-editor-head { padding: 16px 20px 8px; }
      .opt-2 .x-editor-head h2 { margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 500; }
      .opt-2 .x-editor-head p { margin: 3px 0 0; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-2 .x-editor-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 20px; display: grid; gap: 14px; align-content: start; max-width: 640px; }
      .opt-2 .x-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--dim); }
      .opt-2 .x-hint[data-error="true"] { color: var(--danger); }
      .opt-2 .x-editor-foot { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line); }
      .opt-2 .m-btn[disabled] { opacity: 0.5; }
    `,
    initialState() {
      return {
        library: mock.initialSkills(),
        query: "",
        selected: null,
        tab: "overview",
        editing: false,
        creating: false,
        draft: null,
        draftPath: "",
        draftBody: "",
        newScope: "ade-project",
        importPhase: "pick",
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
          `${mock.chrome()}<div class="x-split">${sidebarHtml(ctx)}<main class="x-main">${mainHtml(ctx)}</main></div>${
            state.notice
              ? `<div class="m-notice" role="status">${icons.check}<span>${esc(state.notice.text)}</span></div>`
              : ""
          }`,
        );
        ctx.report(
          `${state.library.length} skills · ${state.selected ? "1 selected" : "none selected"}`,
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
        label: "Sidebar list",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          window.WS.renderKeepFocus(root, sidebarHtml(ctx));
          return {
            update() {
              window.WS.renderKeepFocus(root, sidebarHtml(ctx));
            },
            destroy() {
              root.removeEventListener("click", onClick);
            },
          };
        },
      },
      {
        label: "Bundled files",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () => {
            const state = ctx.getState();
            const skill = state.library.find((s) => s.id === state.selected) || state.library[0];
            window.WS.renderKeepFocus(
              root,
              `<div style="padding:16px"><div class="x-files">${skill.files.map((f) => mock.fileRow(f)).join("")}</div></div>`,
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
