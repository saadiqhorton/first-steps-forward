/* Skills workspace workshop: option registry, shared mock content, and the
 * comparison shell. Options live in options/*.js and call WS.register(). */
(function () {
  "use strict";

  const svg = (body) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

  // Lucide icon paths (the app uses lucide-react).
  const icons = {
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    upload: svg(
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    ),
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    file: svg(
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    ),
    folder: svg(
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    ),
    trash: svg(
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    ),
    pencil: svg(
      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    ),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
    sparkles: svg(
      '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    ),
    package: svg(
      '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="m12 12 8.7-5"/>',
    ),
    archive: svg(
      '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    ),
    alert: svg(
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ),
    code: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    book: svg(
      '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 5 0 0 1 0-5H20"/>',
    ),
    copy: svg(
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ),
    image: svg(
      '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    ),
    more: svg(
      '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    ),
    settings: svg(
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    ),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  };

  /* ------------------------------------------------------------------ */
  /* Sample content — identical for every option                        */
  /* ------------------------------------------------------------------ */

  const BODY_UNTANGLE = `## Purpose

Map the codebase's seams before changing it.

## Steps

1. Read GLOSSARY.md and the ADRs in docs/adr.
2. List the modules a single task would cross.
3. Name the seams and rank them by pressure.

## Output

A short list of seams with the pressure on each one.`;

  const BODY_ARCH = `## Purpose

Surface architectural friction and propose deepening opportunities.

## Process

### 1. Explore

Look for shallow modules: the interface is as complex as the implementation.

### 2. Present

Write a self-contained HTML report to the OS temp directory.

### 3. Grill

Ask about whichever opportunity the user picks.`;

  const BODY_WORKSHOP = `## Purpose

Explore a few interface directions, then build a comparison page.

## Steps

1. Read the source and the design tokens.
2. Create three to five directions with stable numbers.
3. Build artifacts/<workshop>/index.html and share the link.`;

  const BODY_SCREENSHOT = `## Purpose

Review a UI screenshot against the product's own rules.

## Steps

1. Capture the screen.
2. Compare spacing, hierarchy, and state coverage.
3. File one short verdict with a suggested fix.`;

  const BODY_RELEASE = `## Purpose

Turn a merged milestone into release notes that read like a person wrote them.

## Steps

1. Read the merged pull requests.
2. Group them by what changed for users.
3. Write three to five lines, no jargon.`;

  const BODY_SEED = `## Purpose

Create database fixtures for a new feature and keep them deterministic.

## Steps

1. Read the schema.
2. Write the seed script.
3. Run it against a scratch database and check the counts.`;

  const BODY_GENERIC = `## Purpose

Describe what this skill does, in one line.

## Steps

1. Read the request.
2. Do the work.
3. Report the outcome.`;

  const BODY_MINIMAL = `Use this skill when the request matches the description above.`;

  /* Where a skill can live. ADE owns two folders — one per project, one for the
   * machine — so it never depends on another client. Skills found in .agents or
   * .claude are read-only until they are copied in. */
  const SCOPES = [
    {
      id: "ade-project",
      label: "This project",
      path: ".ade/skills",
      hint: "Kept with the repository, in ADE's own folder. Yours to edit.",
    },
    {
      id: "ade-user",
      label: "My ADE",
      path: "~/.ade/skills",
      hint: "Self-contained in ADE's data dir. Available in every project.",
    },
    {
      id: "detected-project",
      label: "Found in the project",
      path: ".agents/skills",
      hint: "Found in the repository, or in .claude/skills. Read-only — copy one in to change it.",
    },
    {
      id: "detected-user",
      label: "Found in your home",
      path: "~/.agents/skills",
      hint: "Shared with the other agent clients on this machine.",
    },
  ];

  /** The optional folders and files a skill folder can carry. */
  const FILE_KINDS = {
    instructions: {
      id: "instructions",
      label: "Instructions",
      hint: "SKILL.md — the body the agent reads when the skill turns on.",
    },
    reference: { id: "reference", label: "Reference", hint: "Read on demand, one level deep." },
    script: { id: "script", label: "Script", hint: "Executable code the agent can run." },
    asset: {
      id: "asset",
      label: "Asset",
      hint: "Templates, images, schemas — resources, not prose.",
    },
    agent: { id: "agent", label: "Agent config", hint: "Client-specific settings for this skill." },
    other: { id: "other", label: "Other", hint: "Anything else in the skill folder." },
  };

  /** The kind of a bundled file, from where it sits in the skill folder. */
  function fileKind(path) {
    if (path === "SKILL.md") return "instructions";
    const top = path.split("/")[0];
    if (top === "references") return "reference";
    if (top === "scripts") return "script";
    if (top === "assets") return "asset";
    if (top === "agents") return "agent";
    return "other";
  }

  /** The Agent Skills name rules: lowercase, digits and single hyphens. */
  const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  function validateName(name) {
    const value = (name || "").trim();
    if (!value) return "A name is required.";
    if (value.length > 64) return "Names are at most 64 characters.";
    if (!NAME_PATTERN.test(value))
      return "Use lowercase letters, numbers, and single hyphens only.";
    return null;
  }

  function validateDescription(description) {
    const value = (description || "").trim();
    if (!value) return "A description is required.";
    if (value.length > 1024) return "Descriptions are at most 1024 characters.";
    return null;
  }

  /** The library every option starts from — what ADE sees for this project. */
  function initialSkills() {
    return [
      {
        id: "design-workshop",
        name: "design-workshop",
        folder: "design-workshop",
        description:
          "Explore a few interface directions, then build a comparison page the user can review.",
        scope: "ade-project",
        path: ".ade/skills/design-workshop",
        files: [
          { path: "SKILL.md", bytes: "5.6 KB" },
          { path: "references/brief.md", bytes: "1.8 KB" },
          { path: "scripts/render.mjs", bytes: "2.2 KB" },
        ],
        body: BODY_WORKSHOP,
        license: "Apache-2.0",
        updated: "1 week ago",
        owned: true,
      },
      {
        id: "release-checklist",
        name: "release-checklist",
        folder: "release-checklist",
        description:
          "Use this skill when a release is cut: check the notes, the version, and the checks before shipping.",
        scope: "ade-project",
        path: ".ade/skills/release-checklist",
        files: [{ path: "SKILL.md", bytes: "1.1 KB" }],
        body: BODY_MINIMAL,
        updated: "2 days ago",
        owned: true,
      },
      {
        id: "pdf-processing",
        name: "pdf-processing",
        folder: "pdf-processing",
        description:
          "Use this skill when a PDF needs text, tables, or filled forms: extract, merge, and write back to the file.",
        scope: "ade-user",
        path: "~/.ade/skills/pdf-processing",
        files: [
          { path: "SKILL.md", bytes: "3.3 KB" },
          { path: "scripts/extract.py", bytes: "4.0 KB" },
          { path: "assets/form-template.pdf", bytes: "82 KB" },
        ],
        body: BODY_GENERIC,
        updated: "3 weeks ago",
        owned: true,
      },
      {
        id: "untangle-codebase",
        name: "untangle-codebase",
        folder: "untangle-codebase",
        description:
          "Untangle a whole codebase in one pass, so agents working in it read less per change, break less without noticing, and debug faster.",
        scope: "detected-project",
        path: ".agents/skills/untangle-codebase",
        files: [{ path: "SKILL.md", bytes: "8.9 KB" }],
        body: BODY_UNTANGLE,
        updated: "2 days ago",
        owned: false,
      },
      {
        id: "improve-codebase-architecture",
        name: "improve-codebase-architecture",
        folder: "improve-codebase-architecture",
        description:
          "Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.",
        scope: "detected-project",
        path: ".agents/skills/improve-codebase-architecture",
        files: [
          { path: "SKILL.md", bytes: "6.0 KB" },
          { path: "agents/openai.yaml", bytes: "0.3 KB" },
        ],
        body: BODY_ARCH,
        updated: "5 days ago",
        owned: false,
      },
    ];
  }

  /** The three packages the workshop's Import control can hand to the mock. */
  const PACKAGES = {
    packaged: {
      key: "packaged",
      fileName: "code-review.skill",
      size: "18 KB",
      kind: ".skill package",
      skills: [
        {
          folder: "code-review",
          name: "code-review",
          description:
            "Use this skill when a diff needs review: check the change against the project's own rules and report one thing to fix first.",
          files: [
            { path: "SKILL.md", bytes: "4.2 KB" },
            { path: "references/CHECKLIST.md", bytes: "1.4 KB" },
          ],
          body: BODY_ARCH,
          license: "MIT",
          warnings: [],
        },
      ],
    },
    zip: {
      key: "zip",
      fileName: "team-skills.zip",
      size: "64 KB",
      kind: ".zip archive",
      skills: [
        {
          folder: "screenshot-review",
          name: "screenshot-review",
          description:
            "Use this skill when a UI screenshot needs a verdict: compare spacing, hierarchy, and state coverage against the product's own rules, then file one short suggested fix.",
          files: [{ path: "SKILL.md", bytes: "2.4 KB" }],
          body: BODY_SCREENSHOT,
          warnings: [],
        },
        {
          folder: "release-notes",
          name: "release-notes-writer",
          description:
            "Use this skill when a milestone ships: turn the merged pull requests into release notes that read like a person wrote them.",
          files: [
            { path: "SKILL.md", bytes: "2.9 KB" },
            { path: "references/changelog.md", bytes: "1.1 KB" },
            { path: "assets/note-template.md", bytes: "0.6 KB" },
          ],
          body: BODY_RELEASE,
          warnings: ["name “release-notes-writer” does not match the folder “release-notes”"],
        },
        {
          folder: "seed-fixtures",
          name: "seed-fixtures",
          description:
            "Use this skill when a new feature needs database fixtures: create deterministic seed data and check the counts against a scratch database.",
          files: [
            { path: "SKILL.md", bytes: "2.1 KB" },
            { path: "scripts/seed.mjs", bytes: "3.4 KB" },
            { path: "assets/schema.sql", bytes: "1.7 KB" },
          ],
          body: BODY_SEED,
          warnings: [],
        },
      ],
    },
    invalid: {
      key: "invalid",
      fileName: "notes.zip",
      size: "9 KB",
      kind: ".zip archive",
      error:
        "notes.zip holds no SKILL.md. A package needs a skill folder with a SKILL.md inside, or a .skill file.",
    },
  };

  const mock = {
    icons,
    initialSkills,
    packages: PACKAGES,
    scopes: SCOPES,
    fileKinds: FILE_KINDS,
    fileKindList: Object.values(FILE_KINDS),
    validateName,
    validateDescription,
    bodyFor: (skill) => skill.body || BODY_MINIMAL,

    scopeOf(skill) {
      return SCOPES.find((s) => s.id === skill.scope) || SCOPES[0];
    },

    /** The path a skill would live at, given its scope and name. */
    pathFor(scopeId, name) {
      const scope = SCOPES.find((s) => s.id === scopeId) || SCOPES[0];
      return `${scope.path}/${name}`;
    },

    fileKind,
    fileKindOf(file) {
      return file.kind || fileKind(file.path);
    },

    /** What the library shows: found skills stay out until they are asked for. */
    visibleSkills(library, detectFound) {
      return library.filter((s) => detectFound || !String(s.scope).startsWith("detected"));
    },

    /** Whether a skill belongs in the current filter. */
    matchesFilter(skill, filter) {
      if (filter === "all") return true;
      if (filter === "detected") return String(skill.scope).startsWith("detected");
      return skill.scope === filter;
    },

    /** The found skills the user is not being shown yet. */
    hiddenFoundSkills(library, detectFound) {
      return detectFound ? [] : library.filter((s) => String(s.scope).startsWith("detected"));
    },

    /** A little sample content for a bundled file, so the editor shows something. */
    sampleFile(file) {
      const kind = mock.fileKindOf(file);
      if (kind === "instructions") return "## Steps\n\n1. Read the request.\n";
      if (kind === "reference")
        return "# Reference\n\nDetail the agent loads only when it needs it.\n";
      if (kind === "script") return "#!/usr/bin/env node\nconsole.log('hello');\n";
      if (kind === "asset") return "Template the skill copies when it writes a file.\n";
      if (kind === "agent") return 'interface:\n  display_name: "Skill name"\n';
      return "Notes kept with the skill.\n";
    },

    /** The kind of a bundled file, with the label and the folder it came from. */
    kindLabel(file) {
      return FILE_KINDS[mock.fileKindOf(file)].label;
    },

    /** What a skill bundles, grouped by kind: references, scripts, assets… */
    bundledKinds(skill) {
      const counts = new Map();
      for (const file of skill.files || []) {
        const kind = mock.fileKindOf(file);
        counts.set(kind, (counts.get(kind) || 0) + 1);
      }
      return [...counts.entries()]
        .filter(([kind]) => kind !== "instructions")
        .map(([kind, count]) => ({ kind, count, label: FILE_KINDS[kind].label }));
    },

    /** The folders a skill bundles beyond SKILL.md. */
    bundledDirs(skill) {
      const dirs = new Set();
      for (const file of skill.files || []) {
        const slash = file.path.indexOf("/");
        if (slash > 0) dirs.add(file.path.slice(0, slash) + "/");
      }
      return [...dirs];
    },

    /** The ADE chrome every option renders inside: top bar + project sections. */
    chrome() {
      return `<header class="m-topbar">
        <span class="m-brand">ADE</span>
        <nav class="m-projects" aria-label="Projects (mock)">
          <span class="m-project" aria-current="page"><span class="m-project-initial">A</span><span class="m-truncate">first-steps-forward</span></span>
          <span class="m-project"><span class="m-project-initial">P</span><span class="m-truncate">portfolio-site</span></span>
        </nav>
        <div class="m-topbar-right"><span>Projects</span><span>${icons.settings}</span><span>${icons.moon}</span></div>
      </header>
      <nav class="m-sections" aria-label="Project sections (mock)">
        <span class="m-section">Conversations</span>
        <span class="m-section">Files</span>
        <span class="m-section">Workflows</span>
        <span class="m-section" aria-current="page">Skills</span>
      </nav>`;
    },

    /** Icon for a bundled file path. */
    fileIcon(path) {
      if (path.endsWith(".md")) return icons.book;
      if (path.endsWith(".yaml") || path.endsWith(".yml")) return icons.code;
      if (
        path.endsWith(".mjs") ||
        path.endsWith(".js") ||
        path.endsWith(".py") ||
        path.endsWith(".sh")
      )
        return icons.code;
      if (path.endsWith(".sql")) return icons.archive;
      if (path.endsWith(".pdf") || path.endsWith(".png") || path.endsWith(".svg"))
        return icons.image;
      return icons.file;
    },

    fileIconFor(skill, path) {
      return mock.fileIcon(path);
    },

    /** One bundled-file row, used by every option's file lists. */
    fileRow(file) {
      return `<div class="m-file-row">
        <span class="m-file-icon">${mock.fileIcon(file.path)}</span>
        <span class="m-file-name m-truncate">${file.path}</span>
        <span class="m-file-kind">${mock.kindLabel(file)}</span>
        <span class="m-label-mono">${file.bytes}</span>
      </div>`;
    },

    /** Import a staged package into a library. Returns the new library. */
    importInto(library, pkg, scopeId = "ade-project") {
      const added = pkg.skills.map((s) => ({
        id: `imported-${s.folder}`,
        name: s.name,
        folder: s.folder,
        description: s.description,
        scope: scopeId,
        path: mock.pathFor(scopeId, s.folder),
        files: s.files.map((f) => ({ ...f })),
        body: s.body || BODY_MINIMAL,
        license: s.license || "",
        updated: "just now",
        fresh: true,
        owned: true,
        warnings: s.warnings || [],
      }));
      const byName = new Map(library.map((s) => [s.folder, s]));
      for (const skill of added) byName.set(skill.folder, skill);
      return [...byName.values()];
    },
  };

  /* ------------------------------------------------------------------ */
  /* Registry + state                                                    */
  /* ------------------------------------------------------------------ */

  const FRAME_WIDTH = 1280;
  const FRAME_HEIGHT = 720;

  const DEFAULT_STATE = Object.freeze({
    packageKey: "packaged",
    mockTheme: "dark",
    // Project skills are detected only when the user asks for them.
    detectFound: false,
  });

  const options = new Map();
  const states = new Map();

  const WS = {
    icons,
    mock,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    DEFAULT_STATE,
    register(option) {
      options.set(option.id, option);
    },
    /** Replace el's markup, then restore focus to the element with the same data-focus key. */
    renderKeepFocus(el, html) {
      const active = document.activeElement;
      const key = active && el.contains(active) ? active.getAttribute("data-focus") : null;
      el.innerHTML = html;
      if (key) el.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
    },
  };
  window.WS = window.WS || WS;

  function stateFor(option) {
    if (!states.has(option.id)) {
      states.set(option.id, { ...DEFAULT_STATE, ...(option.initialState?.() || {}) });
    }
    return states.get(option.id);
  }

  function injectCss(option) {
    if (!option.css || document.getElementById(`opt-css-${option.id}`)) return;
    const style = document.createElement("style");
    style.id = `opt-css-${option.id}`;
    style.textContent = option.css;
    document.head.appendChild(style);
  }

  /**
   * Mount one option instance.
   * ctx.getState() / ctx.setState(partial) hold this option's isolated state.
   * ctx.patch(partial) updates the state without re-rendering (for keystrokes).
   */
  function mountInstance(option, root, { kind, getState, setState, patch, onReport, mountFn }) {
    root.classList.add("mock", `opt-${option.id}`);
    root.dataset.mockTheme = getState().mockTheme;
    const ctx = {
      kind, // "full" | "thumb" | "closeup"
      getState,
      setState,
      patch,
      icons,
      mock,
      report: onReport || (() => {}),
    };
    const fn = mountFn || option.mount;
    const inst = (fn ? fn.call(option, root, ctx) : null) || {};
    return {
      update() {
        root.dataset.mockTheme = getState().mockTheme;
        inst.update?.(getState());
      },
      destroy() {
        inst.destroy?.();
        root.replaceChildren();
        root.className = "";
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shell UI                                                            */
  /* ------------------------------------------------------------------ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const live = [];
  let resizeObs = null;

  function teardown() {
    while (live.length) live.pop().destroy();
    resizeObs?.disconnect();
    resizeObs = null;
  }

  function orderedOptions() {
    return [...options.values()].sort((a, b) => a.id - b.id);
  }

  function renderOverview() {
    teardown();
    $("#view-overview").hidden = false;
    $("#view-option").hidden = true;
    const grid = $("#overview-grid");
    grid.replaceChildren();
    for (const o of orderedOptions()) {
      injectCss(o);
      const card = document.createElement("article");
      card.className = "ov-card";
      card.innerHTML = `
        <a class="ov-thumb" href="#option-${o.id}" aria-label="Open option ${o.id}, ${o.name}">
          <div class="ov-thumb-frame"><div class="ov-thumb-mount"></div></div>
        </a>
        <div class="ov-meta">
          <div class="ov-num">Option ${o.id}</div>
          <h3><a href="#option-${o.id}">${o.name}</a></h3>
          <p>${o.tradeoff}</p>
        </div>`;
      grid.appendChild(card);
      const thumbState = stateFor(o);
      const frame = $(".ov-thumb-frame", card);
      const mountEl = $(".ov-thumb-mount", card);
      mountEl.style.width = `${FRAME_WIDTH}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      const inst = mountInstance(o, mountEl, {
        kind: "thumb",
        getState: () => thumbState,
        setState: () => {},
        patch: () => {},
      });
      live.push(inst);
      const fit = () => {
        const s = frame.clientWidth / FRAME_WIDTH;
        mountEl.style.transform = `scale(${s})`;
        frame.style.height = `${FRAME_HEIGHT * s}px`;
      };
      fit();
      (resizeObs ||= new ResizeObserver(() => frame._fit?.())).observe(frame);
      frame._fit = fit;
    }
  }

  function renderOption(id) {
    const o = options.get(id);
    if (!o) return renderOverview();
    teardown();
    injectCss(o);
    $("#view-overview").hidden = true;
    $("#view-option").hidden = false;

    const list = orderedOptions();
    const idx = list.indexOf(o);
    const prev = list[(idx - 1 + list.length) % list.length];
    const next = list[(idx + 1) % list.length];
    $("#opt-prev").href = `#option-${prev.id}`;
    $("#opt-prev").textContent = `‹ ${prev.id}. ${prev.name}`;
    $("#opt-next").href = `#option-${next.id}`;
    $("#opt-next").textContent = `${next.id}. ${next.name} ›`;
    $("#opt-jump").innerHTML = list
      .map(
        (x) =>
          `<a href="#option-${x.id}" ${x === o ? 'aria-current="page"' : ""} title="${x.name}">${x.id}</a>`,
      )
      .join("");
    $("#opt-eyebrow").textContent = `Option ${o.id}`;
    $("#opt-title").textContent = o.name;
    $("#opt-tradeoff").textContent = o.tradeoff;
    $("#opt-notes").innerHTML = (o.notes || []).map((n) => `<li>${n}</li>`).join("");

    const state = stateFor(o);
    const stage = $("#stage");
    const frame = $("#stage-frame");
    const mountEl = document.createElement("div");
    frame.replaceChildren(mountEl);
    let scale = 1;
    const readout = $("#readout");

    const fit = () => {
      scale = Math.min(1, stage.clientWidth / FRAME_WIDTH);
      mountEl.style.width = `${FRAME_WIDTH}px`;
      mountEl.style.height = `${FRAME_HEIGHT}px`;
      mountEl.style.transform = `scale(${scale})`;
      frame.style.width = `${FRAME_WIDTH * scale}px`;
      frame.style.height = `${FRAME_HEIGHT * scale}px`;
      $("#scale-note").textContent =
        scale < 1 ? `Shown at ${Math.round(scale * 100)}% to fit` : "Shown at 100%";
    };

    const syncControls = () => {
      document.querySelectorAll("#ctl-package button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.packageKey));
      });
      document.querySelectorAll("#ctl-theme button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === state.mockTheme));
      });
      document.querySelectorAll("#ctl-detect button").forEach((b) => {
        b.setAttribute(
          "aria-pressed",
          String((b.dataset.v === "shown") === Boolean(state.detectFound)),
        );
      });
    };

    let reported = "";
    const setState = (partial) => {
      Object.assign(state, partial);
      syncControls();
      for (const inst of live) inst.update();
    };
    const patch = (partial) => {
      Object.assign(state, partial);
    };

    const main = mountInstance(o, mountEl, {
      kind: "full",
      getState: () => state,
      setState,
      patch,
      onReport: (text) => {
        if (text !== reported) readout.textContent = reported = text;
      },
    });
    live.push(main);
    fit();
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(stage);

    // Close-ups: the small controls, shown on their own.
    const closeups = $("#closeups");
    closeups.replaceChildren();
    for (const cu of o.closeups || []) {
      const fig = document.createElement("figure");
      fig.className = "closeup";
      fig.innerHTML = `<figcaption>${cu.label}</figcaption><div class="closeup-box"></div>`;
      closeups.appendChild(fig);
      const box = $(".closeup-box", fig);
      live.push(
        mountInstance(o, box, {
          kind: "closeup",
          getState: () => state,
          setState,
          patch,
          mountFn: cu.mount,
        }),
      );
    }

    // Controls
    $("#ctl-package").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ packageKey: b.dataset.v });
    };
    $("#ctl-theme").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ mockTheme: b.dataset.v });
    };
    $("#ctl-detect").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) setState({ detectFound: b.dataset.v === "shown" });
    };
    $("#ctl-reset").onclick = () => {
      // Remount from scratch so option-internal timers and drafts are cleared too.
      states.delete(o.id);
      renderOption(id);
      $("#ctl-reset").focus();
    };
    readout.textContent = "";
    syncControls();
  }

  function route() {
    const m = /^#option-(\d+)$/.exec(location.hash);
    if (m) {
      renderOption(Number(m[1]));
      window.scrollTo({ top: 0 });
    } else {
      renderOverview();
    }
  }

  WS.start = function () {
    window.addEventListener("hashchange", route);
    route();
  };
})();
