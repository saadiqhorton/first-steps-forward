/* Option 5 — Studio.
 * One skill at a time on a writing canvas: identity, instructions, and
 * bundled files, with a live view of what an agent discovers. */
(function () {
  "use strict";

  const { icons, mock } = window.WS;

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function railHtml(ctx) {
    const state = ctx.getState();
    const hidden = mock.hiddenFoundSkills(state.library, state.detectFound);
    return `<aside class="s-rail" aria-label="Skills">
      <div class="s-rail-head">
        <span class="label-mono">Skills</span>
        <button type="button" class="m-icon-btn" data-act="new" aria-label="New skill" data-focus="rail-new">${icons.plus}</button>
      </div>
      <div class="s-rail-list">
        ${state.library
          .filter((s) => state.detectFound || !String(s.scope).startsWith("detected"))
          .map(
            (s) => `<button type="button" class="s-rail-item${state.selected === s.id ? " is-on" : ""}" data-act="select" data-id="${esc(s.id)}" data-focus="rail-${esc(s.id)}" data-name="${esc(s.name.toLowerCase())}">
              <span class="m-truncate">${esc(s.name)}</span>
              <span class="m-label-mono">${s.files.length}</span>
            </button>`,
          )
          .join("")}
        ${
          hidden.length
            ? `<button type="button" class="s-rail-hidden" data-act="show-project" data-focus="show-project">${icons.folder}<span class="m-truncate">${hidden.length} in .agents/skills</span></button>`
            : ""
        }
      </div>
      <button type="button" class="s-rail-import" data-act="open-import" data-focus="rail-import">${icons.upload}Import</button>
    </aside>`;
  }

  function canvasHtml(ctx) {
    const state = ctx.getState();
    const skill = state.library.find((s) => s.id === state.selected);
    const creating = state.editing === "new";
    const draft = state.draft || {
      name: skill ? skill.name : "",
      description: skill ? skill.description : "",
      body: skill ? mock.bodyFor(skill) : "",
    };
    const nameError = mock.validateName(draft.name);
    const descError = mock.validateDescription(draft.description);
    const dirty =
      creating ||
      !skill ||
      draft.name !== skill.name ||
      draft.description !== skill.description ||
      draft.body !== mock.bodyFor(skill);

    if (!skill && !creating) {
      return `<div class="s-canvas s-canvas-empty">
        <div class="s-empty">
          <span class="s-empty-icon" aria-hidden="true">${icons.sparkles}</span>
          <h2>Nothing open</h2>
          <p>Pick a skill on the left, start a new one, or import a package.</p>
          <button type="button" class="m-btn-amber m-btn" data-act="new" data-focus="empty-new">${icons.plus}New skill</button>
        </div>
      </div>`;
    }

    const files = creating ? [{ path: "SKILL.md", bytes: "0.4 KB" }] : skill.files;
    const scope = skill ? mock.scopeOf(skill) : mock.scopes[0];

    return `<div class="s-canvas">
      <div class="s-canvas-head">
        <div class="min-w-0">
          <div class="m-label-mono">${esc(creating ? mock.pathFor(state.newScope || "ade-project", draft.name || "my-skill") : skill.path)}</div>
          <h2 class="s-canvas-title m-truncate">${esc(draft.name || "Untitled skill")}</h2>
        </div>
        <div class="s-canvas-tools">
          ${
            creating || dirty
              ? `<button type="button" class="m-btn-amber m-btn" data-act="save" data-focus="s-save" ${nameError || descError || (skill && !skill.owned) ? "disabled" : ""}>${creating ? "Create skill" : "Save"}</button>`
              : ""
          }
          ${
            !creating && skill && !skill.owned
              ? `<button type="button" class="m-btn-quiet m-btn" data-act="copy-to-ade" data-id="${esc(skill.id)}" data-focus="s-copy">${icons.copy}Copy into ADE</button>`
              : ""
          }
          ${
            !creating
              ? `<button type="button" class="s-tool" data-act="remove" data-id="${esc(skill.id)}" aria-label="Remove skill" data-focus="s-remove" ${skill && !skill.owned ? "disabled" : ""}>${icons.trash}</button>`
              : `<button type="button" class="m-btn-quiet m-btn" data-act="cancel-edit">Cancel</button>`
          }
        </div>
      </div>
      ${
        skill && !skill.owned
          ? `<div class="s-readonly">${icons.folder}<span>Found in ${esc(scope.path)} — read-only here. Copy it into ADE's own set to change it.</span></div>`
          : ""
      }

      <div class="s-canvas-body">
        <section class="s-section">
          <div class="s-section-head">
            <h3>Identity</h3>
            <span class="m-label-mono">frontmatter</span>
          </div>
          <div class="s-fields">
            <div>
              <label class="m-field-label" for="s-name">name</label>
              <input id="s-name" class="m-input m-input-mono" data-focus="s-name" data-field="name" value="${esc(draft.name)}" placeholder="my-skill" autocomplete="off">
              <p class="s-hint" data-hint="name"${nameError ? ' data-error="true"' : ""}>${esc(nameError || "Lowercase letters, numbers and hyphens. The folder name follows it.")}</p>
            </div>
            <div>
              <label class="m-field-label" for="s-desc">description</label>
              <textarea id="s-desc" class="m-textarea" rows="3" data-focus="s-desc" data-field="description" placeholder="Use this skill when …">${esc(draft.description)}</textarea>
              <p class="s-hint" data-hint="description"${descError ? ' data-error="true"' : ""}>${esc(descError || "Say what it does and when to use it. This is all an agent reads until the skill is activated.")}</p>
            </div>
          </div>
        </section>

        <section class="s-section">
          <div class="s-section-head">
            <h3>Instructions</h3>
            <span class="m-label-mono">SKILL.md body</span>
          </div>
          <textarea class="m-textarea m-textarea-mono s-body-input" rows="12" data-focus="s-body" data-field="body" aria-label="Skill instructions">${esc(draft.body)}</textarea>
          <p class="s-hint">Keep the body short. Long detail belongs in <code>references/</code>, which loads only when it is needed.</p>
        </section>

        <section class="s-section">
          <div class="s-section-head">
            <h3>Bundled files</h3>
            <span class="m-label-mono">${files.length}</span>
          </div>
          <div class="s-files">
            ${files.map((f) => mock.fileRow(f)).join("")}
            <button type="button" class="s-add-file" data-act="add-file" data-focus="s-add-file">${icons.plus}Add a file</button>
          </div>
          <div class="s-kinds">
            ${mock.fileKindList
              .filter((k) => k.id !== "instructions")
              .map(
                (k) =>
                  `<button type="button" class="s-kind" data-act="add-file" data-kind="${k.id}" data-focus="s-kind-${k.id}">
                    <b>${esc(k.label)}</b><span class="m-label-mono">${esc(k.hint)}</span>
                  </button>`,
              )
              .join("")}
          </div>
        </section>
      </div>

      <aside class="s-preview" aria-label="What the agent sees">
        <div class="s-section-head"><h3>Discovery</h3><span class="m-label-mono">always loaded</span></div>
        <div class="s-preview-card">
          <span class="s-preview-name">${esc(draft.name || "my-skill")}</span>
          <p class="s-preview-desc">${esc(draft.description || "No description yet.")}</p>
          <div class="s-preview-files">
            ${files.map((f) => `<span class="m-pill">${esc(f.path)}</span>`).join("")}
          </div>
          ${skill?.license ? `<p class="m-label-mono">license: ${esc(skill.license)}</p>` : ""}
        </div>
        <p class="s-hint">An agent loads the name and description first, the body when the task matches, and the files only if the instructions ask for them.</p>
      </aside>
    </div>`;
  }

  function dialogHtml(ctx) {
    const state = ctx.getState();
    const pkg = state.staged || mock.packages[state.packageKey];
    const phase = state.importPhase;
    const broken = phase === "error";
    const count = pkg.skills ? pkg.skills.length : 0;

    return `<div class="m-scrim">
      <div class="m-dialog" role="dialog" aria-label="Import skills">
        <div class="m-dialog-head">
          <div>
            <h2>Import a package</h2>
            <p>A <code>.skill</code> file, or a <code>.zip</code> with skills inside.</p>
          </div>
          <button type="button" class="m-icon-btn" data-act="close-import" aria-label="Close" data-focus="close-import">${icons.x}</button>
        </div>
        <div class="m-dialog-body">
          ${
            broken
              ? `<div class="s-error">${icons.alert}<div><b>${esc(pkg.fileName)}</b><p>${esc(pkg.error)}</p></div></div>`
              : `<button type="button" class="s-drop" data-act="pick-file" data-focus="pick-file">
                   ${icons.upload}
                   <b>${phase === "staged" ? esc(pkg.fileName) : "Choose or drop a package"}</b>
                   <span>${phase === "staged" ? `${esc(pkg.kind)} · ${esc(pkg.size)}` : ".skill file, or .zip"}</span>
                 </button>`
          }
          ${
            phase === "staged"
              ? `<div class="s-staged">
                  ${pkg.skills
                    .map(
                      (s) => `<div class="s-staged-row">
                        <b class="m-truncate">${esc(s.name)}</b>
                        <span class="s-file-chips">${s.files.map((f) => `<span class="m-pill">${esc(f.path)}</span>`).join("")}</span>
                        ${(s.warnings || []).length ? `<span class="s-warn">${icons.alert}${esc(s.warnings[0])}</span>` : ""}
                      </div>`,
                    )
                    .join("")}
                  <div class="s-scope">
                    <span class="m-field-label">Install into</span>
                    ${mock.scopes
                      .map(
                        (scope) =>
                          `<button type="button" class="s-scope-option${state.importScope === scope.id ? " is-on" : ""}" data-act="scope" data-v="${scope.id}" data-focus="scope-${scope.id}">${esc(scope.path)}</button>`,
                      )
                      .join("")}
                  </div>
                </div>`
              : ""
          }
        </div>
        <div class="m-dialog-foot">
          <button type="button" class="m-btn-quiet m-btn" data-act="close-import">Cancel</button>
          <button type="button" class="m-btn-amber m-btn" data-act="do-import" data-focus="do-import" ${phase === "staged" ? "" : "disabled"}>Install ${count || ""}</button>
        </div>
      </div>
    </div>`;
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
      ctx.setState({ staged: pkg, importPhase: pkg.error ? "error" : "staged" });
      return;
    }
    if (act === "scope") {
      ctx.setState({ importScope: button.dataset.v });
      return;
    }
    if (act === "do-import") {
      const pkg = state.staged || mock.packages[state.packageKey];
      if (!pkg || pkg.error) return;
      ctx.setState({
        library: mock.importInto(state.library, pkg, state.importScope),
        importOpen: false,
        importPhase: "pick",
        staged: null,
        selected: `imported-${pkg.skills[0].folder}`,
        notice: { text: `Installed ${pkg.skills.length} skill${pkg.skills.length === 1 ? "" : "s"}` },
      });
      return;
    }
    if (act === "select") {
      const skill = state.library.find((s) => s.id === button.dataset.id);
      ctx.setState({
        selected: button.dataset.id,
        editing: null,
        draft: skill
          ? { name: skill.name, description: skill.description, body: mock.bodyFor(skill) }
          : null,
      });
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
        draft: { name: copy.name, description: copy.description, body: mock.bodyFor(copy) },
        notice: { text: `Copied “${skill.name}” into ~/.ade/skills` },
      });
      return;
    }
    if (act === "new") {
      ctx.setState({
        editing: "new",
        selected: null,
        draft: { name: "", description: "", body: "" },
      });
      return;
    }
    if (act === "cancel-edit") {
      ctx.setState({ editing: null, draft: null });
      return;
    }
    if (act === "save") {
      const draft = state.draft || { name: "", description: "", body: "" };
      const name = draft.name.trim();
      if (mock.validateName(name) || mock.validateDescription(draft.description)) return;
      const scope = state.newScope || "ade-project";
      if (state.editing === "new") {
        const skill = {
          id: `yours-${name}`,
          name,
          folder: name,
          description: draft.description.trim(),
          scope,
          path: mock.pathFor(scope, name),
          files: [{ path: "SKILL.md", bytes: "0.4 KB" }],
          body: draft.body,
          updated: "just now",
        };
        ctx.setState({
          library: [...state.library, skill],
          editing: null,
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
              body: draft.body,
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
      const skill = state.library.find((s) => s.id === button.dataset.id);
      if (!skill || !skill.owned) return;
      ctx.setState({
        library: state.library.filter((s) => s.id !== skill.id),
        selected: null,
        draft: null,
        notice: { text: `Removed “${skill.name}”` },
      });
      return;
    }
    if (act === "add-file") {
      const skill = state.library.find((s) => s.id === state.selected);
      if (!skill) return;
      const kind = button.dataset.kind || "reference";
      const path =
        kind === "reference"
          ? "references/NOTE.md"
          : kind === "script"
            ? "scripts/run.sh"
            : kind === "asset"
              ? "assets/template.md"
              : kind === "agent"
                ? "agents/openai.yaml"
                : "NOTES.md";
      ctx.setState({
        library: state.library.map((s) =>
          s.id === skill.id
            ? { ...s, files: [...s.files, { path, bytes: "0.2 KB" }] }
            : s,
        ),
        notice: { text: `Added ${path}` },
      });
      return;
    }
  }

  function handleInput(e, ctx) {
    const field = e.target.dataset.field;
    if (!field) return;
    const draft = { ...(ctx.getState().draft || { name: "", description: "", body: "" }) };
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
          : "Say what it does and when to use it. This is all an agent reads until the skill is activated.");
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
    id: 5,
    name: "Studio",
    tradeoff:
      "Authoring one skill feels like writing a document, but browsing twenty skills at once is the weakest part of this shape.",
    notes: [
      "The canvas edits one skill at a time: identity, then the SKILL.md body, then the bundled files. Saving writes the frontmatter and the body together.",
      "The right column shows what an agent actually discovers — name, description, and file list. That is the contract the format rests on, so it is visible while you write.",
      "The rail on the left is only a switchboard. It lists names and file counts, nothing more, because reading happens in the canvas.",
      "The bundled-files section knows what each part is for: <code>references/</code> to read, <code>scripts/</code> to run, <code>assets/</code> to use, and the frontmatter can carry a license or a compatibility note.",
      "In the real code this is the editor for a skill folder: frontmatter fields on top, a markdown body below, and the rest of the folder beside them.",
    ],
    css: `
      .opt-5 .s-split { display: flex; flex: 1; min-height: 0; }
      .opt-5 .s-rail { display: flex; flex-direction: column; width: 200px; flex: none; min-height: 0; border-right: 1px solid var(--line); background: var(--panel); }
      .opt-5 .s-rail-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 10px 14px; }
      .opt-5 .s-rail-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px; }
      .opt-5 .s-rail-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; font-family: var(--font-mono); font-size: 11.5px; color: var(--dim); text-align: left; }
      .opt-5 .s-rail-item:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-5 .s-rail-item.is-on { background: color-mix(in oklab, var(--amber) 14%, transparent); color: var(--ink); }
      .opt-5 .s-rail-hidden { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border-radius: 8px; font-size: 11px; color: var(--dim); }
      .opt-5 .s-rail-hidden:hover { background: color-mix(in oklab, var(--ink) 6%, transparent); color: var(--ink); }
      .opt-5 .s-rail-hidden svg { width: 13px; height: 13px; }
      .opt-5 .s-rail-import { display: flex; align-items: center; gap: 8px; margin: 8px; padding: 8px 10px; border-radius: var(--radius-control); border: 1px dashed color-mix(in oklab, var(--ink) 26%, var(--line)); font-size: 12px; color: var(--dim); }
      .opt-5 .s-rail-import:hover { border-color: var(--amber); color: var(--ink); }
      .opt-5 .s-readonly { display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-bottom: 1px solid var(--line); background: color-mix(in oklab, var(--amber) 12%, transparent); color: var(--amber-deep); font-size: 12px; }
      .opt-5 .s-readonly svg { width: 14px; height: 14px; }
      .opt-5 .s-canvas { display: grid; grid-template-columns: minmax(0, 1fr) 300px; flex: 1; min-width: 0; min-height: 0; background: var(--paper); }
      .opt-5 .s-canvas-empty { display: grid; place-content: center; justify-items: center; grid-template-columns: none; }
      .opt-5 .s-empty { display: grid; justify-items: center; gap: 8px; text-align: center; }
      .opt-5 .s-empty-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: color-mix(in oklab, var(--amber) 16%, transparent); color: var(--amber-deep); }
      .opt-5 .s-empty h2 { margin: 0; font-family: var(--font-display); font-size: 16px; font-weight: 500; }
      .opt-5 .s-empty p { margin: 0; font-size: 12.5px; color: var(--dim); max-width: 34ch; }
      .opt-5 .s-canvas-head { grid-column: 1 / -1; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 20px 12px; border-bottom: 1px solid var(--line); }
      .opt-5 .s-canvas-title { margin: 2px 0 0; font-family: var(--font-display); font-size: 20px; font-weight: 500; letter-spacing: -0.02em; }
      .opt-5 .s-canvas-tools { display: flex; align-items: center; gap: 8px; flex: none; }
      .opt-5 .s-tool { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-control); color: var(--dim); }
      .opt-5 .s-tool:hover { color: var(--danger); background: color-mix(in oklab, var(--danger) 12%, transparent); }
      .opt-5 .s-canvas-body { grid-column: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 18px 20px 40px; display: grid; gap: 22px; align-content: start; }
      .opt-5 .s-section { display: grid; gap: 10px; }
      .opt-5 .s-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .opt-5 .s-section-head h3 { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 500; }
      .opt-5 .s-fields { display: grid; gap: 12px; max-width: 640px; }
      .opt-5 .m-input-mono { font-family: var(--font-mono); font-size: 12px; }
      .opt-5 .s-hint { margin: 0; font-size: 11.5px; color: var(--dim); max-width: 68ch; }
      .opt-5 .s-hint[data-error="true"] { color: var(--danger); }
      .opt-5 .s-body-input { max-width: 640px; }
      .opt-5 .s-files { border: 1px solid var(--line); border-radius: var(--radius-control); overflow: hidden; max-width: 640px; background: var(--panel); }
      .opt-5 .m-file-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; }
      .opt-5 .m-file-row + .m-file-row { border-top: 1px solid var(--line); }
      .opt-5 .m-file-icon { color: var(--dim); display: grid; place-items: center; }
      .opt-5 .m-file-icon svg { width: 14px; height: 14px; }
      .opt-5 .m-file-name { font-family: var(--font-mono); font-size: 11.5px; }
      .opt-5 .s-add-file { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 10px; font-size: 12px; color: var(--dim); border-top: 1px solid var(--line); }
      .opt-5 .s-add-file:hover { color: var(--ink); }
      .opt-5 .s-kinds { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); max-width: 640px; }
      .opt-5 .s-kind { display: grid; gap: 2px; padding: 8px 10px; border-radius: var(--radius-control); border: 1px dashed var(--line); text-align: left; }
      .opt-5 .s-kind:hover { border-color: var(--amber); }
      .opt-5 .s-kind b { font-size: 12.5px; font-weight: 500; }
      .opt-5 .s-kind .m-label-mono { font-size: 10.5px; }
      .opt-5 .s-preview { grid-column: 2; min-width: 0; overflow-y: auto; padding: 18px 18px 40px; border-left: 1px solid var(--line); background: var(--panel); display: grid; gap: 10px; align-content: start; }
      .opt-5 .s-preview-card { display: grid; gap: 6px; padding: 12px; border-radius: var(--radius-control); border: 1px solid var(--line); background: var(--paper); }
      .opt-5 .s-preview-name { font-family: var(--font-mono); font-size: 12.5px; font-weight: 500; }
      .opt-5 .s-preview-desc { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dim); }
      .opt-5 .s-preview-files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
      .opt-5 .s-drop { display: grid; place-items: center; gap: 4px; width: 100%; padding: 20px 14px; border-radius: var(--radius-control); border: 1px dashed color-mix(in oklab, var(--ink) 28%, var(--line)); font-size: 12.5px; color: var(--dim); }
      .opt-5 .s-drop:hover { border-color: var(--amber); color: var(--ink); }
      .opt-5 .s-drop b { font-size: 13px; color: var(--ink); font-weight: 500; }
      .opt-5 .s-staged { margin-top: 12px; display: grid; gap: 8px; }
      .opt-5 .s-staged-row { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-control); }
      .opt-5 .s-staged-row b { font-size: 12.5px; }
      .opt-5 .s-file-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .opt-5 .s-warn { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--amber-deep); }
      .opt-5 .s-warn svg { width: 12px; height: 12px; }
      .opt-5 .s-scope { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
      .opt-5 .s-scope-option { padding: 5px 9px; border-radius: 8px; border: 1px solid var(--line); font-family: var(--font-mono); font-size: 11px; color: var(--dim); }
      .opt-5 .s-scope-option.is-on { border-color: var(--amber); color: var(--ink); }
      .opt-5 .s-error { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 12px; border-radius: var(--radius-control); background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--danger); font-size: 12.5px; }
      .opt-5 .s-error p { margin: 4px 0 0; }
      .opt-5 .m-btn[disabled] { opacity: 0.5; }
      /* Narrow close-ups: the discovery column drops under the canvas. */
      .opt-5 .s-cu { container-type: inline-size; container-name: cu; height: 100%; }
      @container cu (max-width: 780px) {
        .opt-5 .s-canvas { grid-template-columns: minmax(0, 1fr); }
        .opt-5 .s-preview { grid-column: 1; border-left: 0; border-top: 1px solid var(--line); }
      }
    `,
    initialState() {
      return {
        library: mock.initialSkills(),
        selected: mock.initialSkills()[0].id,
        editing: null,
        draft: null,
        newScope: "project",
        importOpen: false,
        importPhase: "pick",
        importScope: "project",
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
          `${mock.chrome()}<div class="s-split">${railHtml(ctx)}${canvasHtml(ctx)}</div>${
            state.importOpen ? dialogHtml(ctx) : ""
          }${
            state.notice
              ? `<div class="m-notice" role="status">${icons.check}<span>${esc(state.notice.text)}</span></div>`
              : ""
          }`,
        );
        ctx.report(`${state.library.length} skills · editing one at a time`);
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
        label: "Skill canvas",
        mount(root, ctx) {
          ctx.root = root;
          const onClick = (e) => handleClick(e, ctx);
          root.addEventListener("click", onClick);
          const render = () =>
            window.WS.renderKeepFocus(root, `<div class="s-cu">${canvasHtml(ctx)}</div>`);
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
        label: "Discovery preview",
        mount(root, ctx) {
          ctx.root = root;
          const render = () => {
            const state = ctx.getState();
            const skill = state.library.find((s) => s.id === state.selected) || state.library[0];
            const draft = state.draft || { name: skill.name, description: skill.description };
            window.WS.renderKeepFocus(
              root,
              `<div style="padding:16px;display:grid;gap:10px">
                 <div class="s-section-head"><h3>Discovery</h3><span class="m-label-mono">always loaded</span></div>
                 <div class="s-preview-card">
                   <span class="s-preview-name">${esc(draft.name)}</span>
                   <p class="s-preview-desc">${esc(draft.description)}</p>
                   <div class="s-preview-files">${skill.files.map((f) => `<span class="m-pill">${esc(f.path)}</span>`).join("")}</div>
                 </div>
               </div>`,
            );
          };
          render();
          return { update: render, destroy() {} };
        },
      },
    ],
  });
})();
