/* Option 1 — Gallery + drawer.
 * A card grid for scanning the library; a right-hand drawer for one skill's
 * files and SKILL.md body; a centred dialog for importing a package. */
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
        : scope === "detected-project"
          ? "Found"
          : "Found (home)";

  function cardHtml(skill, state) {
    const kinds = mock.bundledKinds(skill);
    const selected = state.selected === skill.id;
    return `<button type="button" class="g-card${selected ? " is-selected" : ""}" data-act="select" data-id="${esc(skill.id)}" data-focus="card-${esc(skill.id)}" data-scope="${esc(skill.scope)}" data-name="${esc(skill.name.toLowerCase())}">
      <span class="g-card-head">
        <span class="g-icon" aria-hidden="true">${icons.sparkles}</span>
        ${skill.fresh ? `<span class="m-pill" data-tone="new">just imported</span>` : ""}
        <span class="m-pill">${skill.files.length} ${skill.files.length === 1 ? "file" : "files"}</span>
      </span>
      <span class="g-card-name">${esc(skill.name)}</span>
      <span class="g-card-desc">${esc(skill.description)}</span>
      ${
        kinds.length
          ? `<span class="g-dirs">${kinds.map((k) => `<span class="m-pill">${k.count} ${esc(k.label.toLowerCase())}</span>`).join("")}</span>`
          : `<span class="g-dirs"><span class="m-pill" data-tone="muted">name + description only</span></span>`
      }
      <span class="g-card-foot">
        <span class="m-label-mono">${esc(scopeLabel(skill.scope))}</span>
        <span class="m-label-mono">${esc(skill.updated)}</span>
      </span>
    </button>`;
  }

  /** The file view of the drawer: a list of bundled files beside an editor. */
  function fileEditorHtml(ctx, skill) {
    const state = ctx.getState();
    const bundled = skill.files.filter((file) => file.path !== "SKILL.md");
    const open =
      state.openFile && bundled.some((f) => f.path === state.openFile)
        ? state.openFile
        : (bundled[0]?.path ?? null);
    const file = bundled.find((f) => f.path === open) ?? null;
    const body = file ? mock.sampleFile(file) : "";
    return `<div class="g-files-editor">
        <div class="g-files-list">
          ${bundled
            .map(
              (
                f,
              ) => `<button type="button" class="g-file${f.path === open ? " is-on" : ""}" data-act="open-file" data-path="${esc(f.path)}" data-focus="file-${esc(f.path)}">
                <span class="m-truncate">${esc(f.path)}</span>
                <span class="m-label-mono">${esc(mock.kindLabel(f))}</span>
              </button>`,
            )
            .join("")}
          <button type="button" class="g-file-add" data-act="add-file" data-focus="add-file">${icons.plus}Add a file</button>
        </div>
        <div class="g-file-editor">
          <div class="g-file-head">
            <span class="m-truncate g-file-path">${esc(file?.path ?? "")}</span>
            <button type="button" class="m-btn-amber m-btn" data-act="save-file" data-focus="save-file">Save</button>
          </div>
          <textarea class="g-file-body" data-focus="file-body" data-field="file-body" spellcheck="false">${esc(body)}</textarea>
          <p class="g-hint">${
            file
              ? mock.fileKinds[mock.fileKindOf(file)].hint
              : "This skill has no bundled files yet."
          }</p>
        </div>
      </div>`;
  }

  function detailHtml(ctx) {
    const state = ctx.getState();
    const skill = state.library.find((s) => s.id === state.selected);
    if (state.creating) {
      const draft = state.draft || { name: "", description: "" };
      const nameError = mock.validateName(draft.name);
      const descError = mock.validateDescription(draft.description);
      return `<aside class="g-drawer" aria-label="New skill">
        <div class="g-drawer-head">
          <div>
            <h2 class="g-drawer-title">New skill</h2>
            <p class="g-drawer-sub">Name and description are all an agent needs to start.</p>
          </div>
          <button type="button" class="m-icon-btn" data-act="cancel-edit" aria-label="Close editor" data-focus="cancel-edit">${icons.x}</button>
        </div>
        <div class="g-drawer-body">
          <div>
            <label class="m-field-label" for="g-name">Name</label>
            <input id="g-name" class="m-input" data-focus="g-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off" aria-describedby="g-name-hint">
            <p class="g-hint" id="g-name-hint"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens. The folder name follows it.")}</p>
          </div>
          <div>
            <label class="m-field-label" for="g-desc">Description</label>
            <textarea id="g-desc" class="m-textarea" rows="5" data-focus="g-desc" data-field="description" placeholder="Use this skill when …">${esc(draft.description)}</textarea>
            <p class="g-hint" id="g-desc-hint"${descError ? ' data-error="true"' : ""}>${esc(descError || `Say what it does and when to use it. ${(draft.description || "").length}/1024 characters.`)}</p>
          </div>
          <p class="g-hint">A skill you write here starts as name and description. Add folders and files once the agent needs them.</p>
        </div>
        <div class="g-drawer-foot">
          <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="save-skill" ${nameError || descError ? "disabled" : ""}>Create skill</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
        </div>
      </aside>`;
    }
    if (!skill) return "";
    const editing = state.editing === skill.id;
    const draft = state.draft || { name: skill.name, description: skill.description };
    const nameError = mock.validateName(draft.name);
    const descError = mock.validateDescription(draft.description);
    const scope = mock.scopeOf(skill);

    if (editing) {
      return `<aside class="g-drawer" aria-label="${state.creating ? "New skill" : "Edit skill"}">
        <div class="g-drawer-head">
          <div>
            <h2 class="g-drawer-title">${state.creating ? "New skill" : "Edit skill"}</h2>
            <p class="g-drawer-sub">${state.creating ? "Name and description are all an agent needs to start." : esc(skill.path)}</p>
          </div>
          <button type="button" class="m-icon-btn" data-act="cancel-edit" aria-label="Close editor" data-focus="cancel-edit">${icons.x}</button>
        </div>
        <div class="g-drawer-body">
          <div>
            <label class="m-field-label" for="g-name">Name</label>
            <input id="g-name" class="m-input" data-focus="g-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off" aria-describedby="g-name-hint">
            <p class="g-hint" id="g-name-hint"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens. The folder name follows it.")}</p>
          </div>
          <div>
            <label class="m-field-label" for="g-desc">Description</label>
            <textarea id="g-desc" class="m-textarea" rows="5" data-focus="g-desc" data-field="description" placeholder="Use this skill when …">${esc(draft.description)}</textarea>
            <p class="g-hint" id="g-desc-hint"${descError ? ' data-error="true"' : ""}>${esc(descError || `Say what it does and when to use it. ${(draft.description || "").length}/1024 characters.`)}</p>
          </div>
          ${
            state.creating
              ? `<p class="g-hint">A skill you write here starts as name and description. Add folders and files once the agent needs them.</p>`
              : `<p class="g-hint">Bundled files (${skill.files.length}) stay as they are.</p>`
          }
        </div>
        <div class="g-drawer-foot">
          <button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="save-skill" ${nameError || descError ? "disabled" : ""}>${state.creating ? "Create skill" : "Save changes"}</button>
          <button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>
        </div>
      </aside>`;
    }

    return `<aside class="g-drawer" aria-label="Skill details">
      <div class="g-drawer-head">
        <div class="min-w-0">
          <h2 class="g-drawer-title m-truncate">${esc(skill.name)}</h2>
          <p class="g-drawer-sub m-truncate">${esc(skill.path)}</p>
        </div>        <button type="button" class="m-icon-btn" data-act="close-detail" aria-label="Close details" data-focus="close-detail">${icons.x}</button>
      </div>
      <div class="g-drawer-body${state.view === "files" ? " g-drawer-body-files" : ""}">
        ${
          state.view === "files"
            ? fileEditorHtml(ctx, skill)
            : `<p class="g-detail-desc">${esc(skill.description)}</p>
        ${
          skill.owned
            ? ""
            : `<div class="g-hint g-readonly">${icons.folder}<span>Found in ${esc(scope.path)} — read-only here. Copy it into ADE's own set to change it.</span></div>`
        }
        ${
          (skill.warnings || []).length
            ? `<div class="g-warning">${icons.alert}<span>${esc(skill.warnings[0])}</span></div>`
            : ""
        }
        <div class="g-section">
          <div class="label-section">Bundled files</div>
          <div class="g-files">
            ${
              skill.files.length
                ? skill.files.map((f) => mock.fileRow(f)).join("")
                : `<p class="g-hint">No files yet — this skill is name and description only.</p>`
            }
          </div>
          ${
            mock.bundledKinds(skill).length
              ? `<p class="g-hint">${mock
                  .bundledKinds(skill)
                  .map((k) => `${k.count} ${k.label.toLowerCase()}`)
                  .join(" · ")} — loaded only when the instructions ask for them.</p>`
              : ""
          }
        </div>
        <div class="g-section">
          <div class="label-section">SKILL.md</div>
          <pre class="g-body">${esc(mock.bodyFor(skill))}</pre>
        </div>`
        }
      <div class="g-drawer-foot">
        ${
          state.view === "files"
            ? `<button type="button" class="m-btn-quiet m-btn" data-act="show-detail" data-focus="back-detail">Back to the skill</button>`
            : `<button type="button" class="m-btn-quiet m-btn" data-act="edit" data-id="${esc(skill.id)}" data-focus="edit-skill" ${skill.owned ? "" : "disabled"}>${icons.pencil}Edit</button>
               <button type="button" class="m-btn-quiet m-btn" data-act="open-files" data-id="${esc(skill.id)}" data-focus="edit-files" ${skill.owned ? "" : "disabled"}>${icons.file}Edit files</button>`
        }
        ${
          !skill.owned
            ? `<button type="button" class="m-btn-quiet m-btn" data-act="copy-to-ade" data-id="${esc(skill.id)}" data-focus="copy-skill">${icons.copy}Copy into ADE</button>`
            : state.confirmRemove === skill.id
              ? `<span class="g-confirm">Remove this skill? <button type="button" class="g-confirm-yes" data-act="remove-yes" data-id="${esc(skill.id)}" data-focus="remove-yes">Remove</button> <button type="button" class="g-confirm-no" data-act="remove-no">Keep</button></span>`
              : `<button type="button" class="g-btn-danger" data-act="remove" data-id="${esc(skill.id)}" data-focus="remove-skill">${icons.trash}Remove</button>`
        }
      </div>
    </aside>`;
  }

  function dialogHtml(ctx) {
    const state = ctx.getState();
    const phase = state.importPhase;
    const pkg = state.staged || mock.packages[state.packageKey];
    const broken = phase === "error";
    const count = pkg.skills ? pkg.skills.length : 0;

    return `<div class="m-scrim g-scrim">
      <div class="m-dialog" role="dialog" aria-label="Import skills">
        <div class="m-dialog-head">
          <div>
            <h2>Import skills</h2>
            <p>One <code>.skill</code> package, or a <code>.zip</code> that holds several skills.</p>
          </div>
          <button type="button" class="m-icon-btn" data-act="close-import" aria-label="Close import" data-focus="close-import">${icons.x}</button>
        </div>
        <div class="m-dialog-body">
          ${
            broken
              ? `<div class="g-error">${icons.alert}<div><b>${esc(pkg.fileName)}</b><p>${esc(pkg.error)}</p></div></div>
                 <button type="button" class="m-btn-quiet m-btn g-pick" data-act="pick-file" data-focus="pick-again">${icons.upload}Choose another file</button>`
              : `<button type="button" class="g-drop" data-act="pick-file" data-focus="pick-file">
                   ${icons.upload}
                   <b>${phase === "staged" ? esc(pkg.fileName) : "Drop a package here"}</b>
                   <span>${phase === "staged" ? `${esc(pkg.kind)} · ${esc(pkg.size)}` : "or choose a .skill file or .zip"}</span>
                 </button>`
          }
          ${
            phase === "staged"
              ? `<div class="g-staged">
                   <div class="label-section">${count} skill${count === 1 ? "" : "s"} found</div>
                   ${pkg.skills
                     .map(
                       (s) => `<div class="g-staged-row">
                         <span class="g-icon" aria-hidden="true">${icons.package}</span>
                         <div class="min-w-0">
                           <b class="m-truncate">${esc(s.name)}</b>
                           <p class="m-truncate">${esc(s.description)}</p>
                           <span class="g-file-chips">${s.files.map((f) => `<span class="m-pill">${esc(f.path)}</span>`).join("")}</span>
                           ${(s.warnings || []).length ? `<span class="g-warn-line">${icons.alert}${esc(s.warnings[0])}</span>` : ""}
                         </div>
                       </div>`,
                     )
                     .join("")}
                   <div class="g-scope">
                     <span class="m-field-label">Install into</span>
                     ${mock.scopes
                       .map(
                         (scope) =>
                           `<button type="button" class="g-scope-option${state.importScope === scope.id ? " is-on" : ""}" data-act="scope" data-v="${scope.id}" data-focus="scope-${scope.id}">
                              <b>${esc(scope.label)}</b><span class="m-label-mono">${esc(scope.path)}</span>
                              <span class="g-scope-hint">${esc(scope.hint)}</span>
                            </button>`,
                       )
                       .join("")}
                   </div>
                 </div>`
              : ""
          }
        </div>
        <div class="m-dialog-foot">
          <button type="button" class="m-btn-quiet m-btn" data-act="close-import">Cancel</button>
          <button type="button" class="m-btn-amber m-btn" data-act="do-import" data-focus="do-import" ${phase === "staged" ? "" : "disabled"}>Import ${count || ""} skill${count === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>`;
  }

  function workspaceHtml(ctx) {
    const state = ctx.getState();
    const visible = mock.visibleSkills(state.library, state.detectFound);
    const hidden = mock.hiddenFoundSkills(state.library, state.detectFound);
    const shown = visible.filter((s) => {
      if (!mock.matchesFilter(s, state.filter)) return false;
      const term = state.query.trim().toLowerCase();
      if (!term) return true;
      return s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);
    });

    return `<div class="g-inner">
      <div class="g-head">
        <div class="min-w-0">
          <h1 class="g-title">Skills</h1>
          <p class="g-sub">Instructions an agent loads on demand. ADE keeps its own set in <code>~/.ade/skills</code>.</p>
        </div>
        <div class="g-actions">
          <button type="button" class="m-btn-quiet m-btn" data-act="open-import" data-focus="open-import">${icons.upload}Import</button>
          <button type="button" class="m-btn-amber m-btn" data-act="new" data-focus="new-skill">${icons.plus}New skill</button>
        </div>
      </div>
      <div class="g-bar">
        <div class="g-search">
          ${icons.search}
          <input type="search" value="${esc(state.query)}" placeholder="Search skills" aria-label="Search skills" data-focus="g-search" data-field="query">
        </div>
        <div class="g-filters" role="group" aria-label="Filter skills">
          ${FILTERS.map(
            (f) =>
              `<button type="button" class="g-filter${state.filter === f.id ? " is-on" : ""}" data-act="filter" data-v="${esc(f.id)}" data-focus="filter-${esc(f.id)}">${f.label}</button>`,
          ).join("")}
        </div>
      </div>
      ${
        hidden.length
          ? `<div class="g-hidden">
              ${icons.folder}
              <span>${hidden.length} skill${hidden.length === 1 ? "" : "s"} found in <code>.agents/skills</code> are not shown.</span>
              <button type="button" class="m-btn-quiet m-btn" data-act="show-project" data-focus="show-project">Show them</button>
            </div>`
          : ""
      }
      ${
        shown.length
          ? `<div class="g-grid">${shown.map((s) => cardHtml(s, state)).join("")}</div>`
          : `<p class="m-empty">No skills match this search.</p>`
      }
    </div>`;
  }

  function noticeHtml(ctx) {
    const notice = ctx.getState().notice;
    if (!notice) return "";
    return `<div class="m-notice" data-tone="${esc(notice.tone || "ok")}" role="status">${notice.tone === "error" ? icons.alert : icons.check}<span>${esc(notice.text)}</span></div>`;
  }

  function handleClick(e, ctx) {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    const state = ctx.getState();

    if (act === "open-import") {
      ctx.setState({ importOpen: true, importPhase: "pick", staged: null });
      return;
    }
    if (act === "close-import") {
      ctx.setState({ importOpen: false });
      return;
    }
    if (act === "pick-file") {
      const pkg = mock.packages[state.packageKey];
      ctx.setState({
        staged: pkg,
        importPhase: pkg.error ? "error" : "staged",
      });
      return;
    }
    if (act === "scope") {
      ctx.setState({ importScope: button.dataset.v });
      return;
    }
    if (act === "do-import") {
      const pkg = state.staged || mock.packages[state.packageKey];
      if (!pkg || pkg.error) return;
      const library = mock.importInto(state.library, pkg, state.importScope);
      ctx.setState({
        library,
        importOpen: false,
        importPhase: "pick",
        staged: null,
        selected: `imported-${pkg.skills[0].folder}`,
        notice: {
          text: `Imported ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"} into ${mock.scopeOf({ scope: state.importScope }).path}`,
        },
      });
      return;
    }
    if (act === "select") {
      ctx.setState({
        selected: button.dataset.id,
        editing: null,
        creating: false,
        view: "detail",
        openFile: null,
      });
      return;
    }
    if (act === "close-detail") {
      ctx.setState({ selected: null, editing: null, creating: false, confirmRemove: null });
      return;
    }
    if (act === "edit") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill) return;
      ctx.setState({
        editing: skill.id,
        creating: false,
        draft: { name: skill.name, description: skill.description },
      });
      return;
    }
    if (act === "new") {
      ctx.setState({
        creating: true,
        editing: null,
        selected: null,
        draft: { name: "", description: "" },
      });
      return;
    }
    if (act === "cancel-edit") {
      ctx.setState({ editing: null, creating: false, draft: null });
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
          editing: null,
          draft: null,
          selected: skill.id,
          notice: { text: `Created “${name}”` },
        });
        return;
      }
      const skill = state.library.find((s) => s.id === state.editing);
      if (!skill) return;
      const library = state.library.map((s) =>
        s.id === skill.id
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
      ctx.setState({
        library,
        editing: null,
        draft: null,
        notice: { text: `Saved “${name}”` },
      });
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
        notice: { text: `Removed “${skill ? skill.name : "skill"}”` },
      });
      return;
    }
    if (act === "open-files") {
      ctx.setState({ view: "files", openFile: null });
      return;
    }
    if (act === "show-detail") {
      ctx.setState({ view: "detail", openFile: null });
      return;
    }
    if (act === "open-file") {
      ctx.setState({ view: "files", openFile: button.dataset.path });
      return;
    }
    if (act === "add-file") {
      const skill = state.library.find((s) => s.id === state.selected);
      if (!skill || !skill.owned) return;
      const file = { path: "references/NOTE.md", bytes: "0.2 KB" };
      ctx.setState({
        library: state.library.map((s) =>
          s.id === skill.id ? { ...s, files: [...s.files, file] } : s,
        ),
        view: "files",
        openFile: file.path,
        notice: { text: "Added references/NOTE.md" },
      });
      return;
    }
    if (act === "save-file") {
      const skill = state.library.find((s) => s.id === state.selected);
      if (!skill) return;
      ctx.setState({ notice: { text: "File saved" } });
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
        notice: { text: `Copied “${skill.name}” into ~/.ade/skills` },
      });
    }
  }

  function handleInput(e, ctx) {
    const field = e.target.dataset.field;
    if (!field) return;
    if (field === "query") {
      ctx.patch({ query: e.target.value });
      // Filter without re-rendering so the caret stays in the search box.
      const state = ctx.getState();
      const term = state.query.trim().toLowerCase();
      ctx.root.querySelectorAll(".g-card").forEach((el) => {
        const scope = el.dataset.scope;
        const name = el.dataset.name || "";
        const ok = mock.matchesFilter({ scope }, state.filter) && (!term || name.includes(term));
        el.style.display = ok ? "" : "none";
      });
      return;
    }
    if (field === "name" || field === "description") {
      const draft = { ...(ctx.getState().draft || { name: "", description: "" }) };
      draft[field] = e.target.value;
      ctx.patch({ draft });
      const hint = ctx.root.querySelector(field === "name" ? "#g-name-hint" : "#g-desc-hint");
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
  }

  WS.register({
    id: 1,
    name: "Gallery + drawer",
    tradeoff:
      "Cards make the library scannable and the drawer keeps a skill's files one click away, but the drawer competes with the grid for width.",
    notes: [
      "The library is a card grid, like the Workflows section that already exists. Each card carries the one thing that differs between skills: a name and description, or a package with extra folders.",
      "Clicking a card opens a right-hand drawer with the bundled file list and the SKILL.md body. Editing happens in the same drawer, so nothing leaves the page.",
      "The editor checks the Agent Skills rules while you type: lowercase name, and a description that says what the skill does and when to use it.",
      "Import is a centred dialog: pick a package, read what was found inside it, choose a scope, then import. A file that is not a skill explains itself instead of failing silently.",
      "The drawer has a files view: every reference, script and asset in the skill is listed and edited in place, next to the file it belongs to.",
      "ADE's own skills live in <code>.ade/skills</code> for the project and <code>~/.ade/skills</code> for the machine, so nothing depends on another client. Skills found in <code>.agents/skills</code> or <code>.claude/skills</code> are read-only, and stay out of the list until you ask for them; copy one in to make it yours.",
      "In the real code this becomes a <code>/p/$projectId/skills</code> route with a card grid, a drawer, and an import dialog — the same three pieces the Workflows page already has.",
    ],
    css: `
      .opt-1 .g-stage { position: relative; display: flex; flex: 1; min-height: 0; }
      .opt-1 .g-wrap { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 26px 28px 40px; }
      .opt-1 .g-inner { max-width: 1040px; margin: 0 auto; }
      .opt-1 .g-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
      .opt-1 .g-title { margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 500; letter-spacing: -0.03em; }
      .opt-1 .g-sub { margin: 6px 0 0; font-size: 13px; color: var(--dim); }
      .opt-1 .g-actions { display: flex; gap: 8px; flex: none; }
      .opt-1 .g-bar { display: flex; align-items: center; gap: 16px; margin: 20px 0 0; flex-wrap: wrap; }
      .opt-1 .g-search { position: relative; flex: 1; min-width: 180px; max-width: 320px; }
      .opt-1 .g-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--dim); }
      .opt-1 .g-search input { width: 100%; padding: 7px 10px 7px 30px; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--panel); font-size: 13px; }
      .opt-1 .g-filters { display: flex; gap: 4px; }
      .opt-1 .g-filter { padding: 5px 10px; border-radius: 8px; font-size: 12.5px; color: var(--dim); }
      .opt-1 .g-filter:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-1 .g-filter.is-on { background: color-mix(in oklab, var(--ink) 8%, transparent); color: var(--ink); font-weight: 500; }
      .opt-1 .g-grid { display: grid; gap: 14px; margin: 18px 0 0; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
      .opt-1 .g-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 16px; text-align: left; border-radius: var(--radius-panel); background: var(--panel); border: 1px solid var(--line); }
      .opt-1 .g-card:hover { border-color: color-mix(in oklab, var(--ink) 25%, var(--line)); }
      .opt-1 .g-card.is-selected { border-color: var(--amber); box-shadow: 0 0 0 1px color-mix(in oklab, var(--amber) 40%, transparent); }
      .opt-1 .g-card-head { display: flex; align-items: center; gap: 6px; width: 100%; }
      .opt-1 .g-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; background: color-mix(in oklab, var(--amber) 18%, transparent); color: var(--amber-deep); }
      .opt-1 .g-icon svg { width: 15px; height: 15px; }
      .opt-1 .g-card-head .m-pill { margin-left: 0; }
      .opt-1 .g-card-head .m-pill:last-child { margin-left: auto; }
      .opt-1 .g-card-name { font-size: 14px; font-weight: 500; line-height: 1.3; word-break: break-word; }
      .opt-1 .g-card-desc { font-size: 12px; line-height: 1.55; color: var(--dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .opt-1 .g-dirs { display: flex; flex-wrap: wrap; gap: 4px; }
      .opt-1 .g-dirs .m-pill[data-tone="muted"] { color: var(--dim); }
      .opt-1 .g-card-foot { display: flex; justify-content: space-between; gap: 8px; width: 100%; margin-top: auto; padding-top: 4px; }
      .opt-1 .g-drawer { width: 400px; flex: none; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); }
      .opt-1 .g-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid var(--line); }
      .opt-1 .g-drawer-title { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 500; }
      .opt-1 .g-drawer-sub { margin: 3px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: var(--dim); }
      .opt-1 .g-drawer-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
      .opt-1 .g-detail-desc { margin: 0; font-size: 13px; line-height: 1.6; }
      .opt-1 .g-warning { display: flex; gap: 8px; padding: 8px 10px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--amber) 16%, transparent); color: var(--amber-deep); font-size: 12px; }
      .opt-1 .g-section { display: grid; gap: 8px; }
      .opt-1 .g-files { border: 1px solid var(--line); border-radius: var(--radius-control); overflow: hidden; }
      .opt-1 .m-file-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12px; }
      .opt-1 .m-file-row + .m-file-row { border-top: 1px solid var(--line); }
      .opt-1 .m-file-icon { color: var(--dim); display: grid; place-items: center; }
      .opt-1 .m-file-icon svg { width: 14px; height: 14px; }
      .opt-1 .m-file-name { font-family: var(--font-mono); font-size: 11.5px; }
      .opt-1 .g-hidden { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 10px 12px; border-radius: var(--radius-control); border: 1px dashed var(--line); font-size: 12.5px; color: var(--dim); }
      .opt-1 .g-hidden svg { width: 15px; height: 15px; }
      .opt-1 .g-hidden .m-btn { margin-left: auto; }
      .opt-1 .g-body { margin: 0; padding: 12px; border-radius: var(--radius-control); background: var(--deck); color: var(--deck-foreground); font-family: var(--font-mono); font-size: 11px; line-height: 1.6; overflow: auto; white-space: pre-wrap; }
      .opt-1 .g-drawer-body-files { padding: 0; gap: 0; }
      .opt-1 .g-files-editor { display: flex; flex: 1; min-height: 0; }
      .opt-1 .g-files-list { width: 11rem; flex: none; min-height: 0; overflow-y: auto; border-right: 1px solid var(--line); padding: 6px; }
      .opt-1 .g-file { display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 5px 7px; border-radius: 7px; text-align: left; font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-1 .g-file:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-1 .g-file.is-on { background: color-mix(in oklab, var(--amber) 14%, transparent); color: var(--ink); }
      .opt-1 .g-file-add { display: flex; align-items: center; gap: 5px; width: 100%; margin-top: 4px; padding: 5px 7px; border-radius: 7px; font-size: 11px; color: var(--dim); }
      .opt-1 .g-file-add:hover { color: var(--ink); }
      .opt-1 .g-file-editor { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; padding: 10px 12px; gap: 8px; }
      .opt-1 .g-file-head { display: flex; align-items: center; gap: 8px; }
      .opt-1 .g-file-path { flex: 1; font-family: var(--font-mono); font-size: 11.5px; color: var(--dim); }
      .opt-1 .g-file-body { flex: 1; min-height: 0; resize: none; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--paper); padding: 9px 10px; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6; }
      .opt-1 .g-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--dim); }
      .opt-1 .g-hint[data-error="true"] { color: var(--danger); }
      .opt-1 .g-drawer-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
      .opt-1 .g-btn-danger { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: var(--radius-control); font-size: 13px; color: var(--danger); }
      .opt-1 .g-btn-danger:hover { background: color-mix(in oklab, var(--danger) 12%, transparent); }
      .opt-1 .g-confirm { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); }
      .opt-1 .g-confirm-yes { padding: 4px 8px; border-radius: 6px; background: var(--danger); color: var(--paper); font-size: 12px; }
      .opt-1 .g-confirm-no { padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--dim); text-decoration: underline; }
      .opt-1 .g-drop { display: grid; place-items: center; gap: 4px; width: 100%; padding: 22px 16px; border-radius: var(--radius-control); border: 1px dashed color-mix(in oklab, var(--ink) 28%, var(--line)); background: color-mix(in oklab, var(--ink) 3%, transparent); font-size: 12.5px; color: var(--dim); }
      .opt-1 .g-drop:hover { border-color: var(--amber); color: var(--ink); }
      .opt-1 .g-drop svg { width: 20px; height: 20px; }
      .opt-1 .g-drop b { font-size: 13px; color: var(--ink); font-weight: 500; }
      .opt-1 .g-pick { margin-top: 10px; }
      .opt-1 .g-staged { margin-top: 14px; display: grid; gap: 8px; }
      .opt-1 .g-staged-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-control); }
      .opt-1 .g-staged-row b { font-size: 13px; font-weight: 500; }
      .opt-1 .g-staged-row p { margin: 2px 0 6px; font-size: 11.5px; color: var(--dim); }
      .opt-1 .g-file-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .opt-1 .g-warn-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px; color: var(--amber-deep); }
      .opt-1 .g-warn-line svg { width: 13px; height: 13px; }
      .opt-1 .g-scope { margin-top: 4px; display: grid; gap: 6px; }
      .opt-1 .g-scope-option { display: grid; gap: 2px; padding: 8px 10px; border-radius: var(--radius-control); border: 1px solid var(--line); font-size: 12.5px; text-align: left; }
      .opt-1 .g-scope-option.is-on { border-color: var(--amber); background: color-mix(in oklab, var(--amber) 10%, transparent); }
      .opt-1 .g-scope-hint { font-size: 11px; color: var(--dim); }
      .opt-1 .g-readonly { display: flex; gap: 8px; align-items: flex-start; }
      .opt-1 .g-readonly svg { width: 14px; height: 14px; margin-top: 1px; }
      .opt-1 .m-btn[disabled] { opacity: 0.5; }
      .opt-1 .g-error { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 12px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); font-size: 12.5px; }
      .opt-1 .g-error p { margin: 4px 0 0; }
    `,
    initialState() {
      return {
        library: mock.initialSkills(),
        query: "",
        filter: "all",
        selected: null,
        view: "detail",
        openFile: null,
        editing: null,
        creating: false,
        confirmRemove: null,
        draft: null,
        newScope: "ade-project",
        importOpen: false,
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
          `${mock.chrome()}<div class="g-stage"><div class="g-wrap">${workspaceHtml(ctx)}</div>${detailHtml(ctx)}</div>${state.importOpen ? dialogHtml(ctx) : ""}${noticeHtml(ctx)}`,
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
        label: "Import dialog",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          window.WS.renderKeepFocus(root, dialogHtml(ctx));
          return {
            update() {
              window.WS.renderKeepFocus(root, dialogHtml(ctx));
            },
            destroy() {
              root.removeEventListener("click", onClick);
            },
          };
        },
      },
      {
        label: "Skill card",
        mount(root, ctx) {
          ctx.root = root;
          const render = () => {
            const state = ctx.getState();
            window.WS.renderKeepFocus(
              root,
              `<div style="padding:20px;display:grid;gap:12px">${cardHtml(state.library[0], state)}</div>`,
            );
          };
          render();
          return { update: render, destroy() {} };
        },
      },
    ],
  });
})();
