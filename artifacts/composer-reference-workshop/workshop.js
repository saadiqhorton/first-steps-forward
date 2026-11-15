const options = [
  {
    id: 1,
    name: "Inline tokens",
    tradeoff:
      "References sit exactly where you mention them, but editing a sentence becomes a richer interaction.",
    note: "A compact pill stays in the sentence, so the connection between a reference and the surrounding words is immediate.",
  },
  {
    id: 2,
    name: "Pill shelf",
    tradeoff:
      "A single row keeps every selection easy to scan and remove, but separates references from the words that mention them.",
    note: "Every selection uses the existing workflow-pill pattern above a familiar plain-text draft.",
  },
  {
    id: 3,
    name: "Context footer",
    tradeoff:
      "The writing area stays calm and familiar, while a labeled row keeps selected context near the send controls.",
    note: "Selections collect below the message in a labeled context row, keeping the top of the composer focused on the draft.",
  },
  {
    id: 4,
    name: "Context rail",
    tradeoff:
      "A dedicated side area makes context feel organized and persistent, but uses more horizontal space.",
    note: "A compact side rail lists the current context; on a narrow screen it moves beneath the draft.",
  },
];
const samples = [
  {
    id: "review",
    type: "workflow",
    name: "Review code",
    detail: "Check changes and suggest improvements",
    icon: "Workflow",
  },
  {
    id: "design",
    type: "skill",
    name: "product-design",
    detail: "Explore and refine interface design",
    icon: "Sparkles",
  },
  {
    id: "file",
    type: "file",
    name: "Onboarding.tsx",
    detail: "src/components/Onboarding.tsx",
    icon: "File",
  },
  {
    id: "folder",
    type: "folder",
    name: "onboarding",
    detail: "src/components/onboarding/",
    icon: "Folder",
  },
  {
    id: "tests",
    type: "file",
    name: "onboarding.test.ts",
    detail: "src/components/onboarding.test.ts",
    icon: "File",
  },
];
const sampleDraft = "Please review the onboarding flow and suggest improvements.";
const instances = new Map();
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const chip = (item, removable = true) =>
  `<span class="chip" contenteditable="false" data-chip="${item.id}" title="${escapeHTML(item.detail)}">${icons[item.icon]}<span class="chip-label">${escapeHTML(item.name)}</span>${item.type === "workflow" ? '<span class="chip-kind">Workflow</span>' : ""}${removable ? `<button class="remove" type="button" aria-label="Remove ${escapeHTML(item.name)}">${icons.X}</button>` : ""}</span>`;
const footer = () =>
  `<div class="composer-footer"><div class="agent-chip">Codex<small>gpt-6.1 · build</small></div><div class="branch">${icons.GitBranch} main</div><div class="footer-spacer"></div><button type="button" class="tiny slash" aria-label="Add workflow or skill">/</button><button type="button" class="tiny at" aria-label="Add file or folder">@</button><button type="button" class="tiny" aria-label="Attach file" title="Sample control">${icons.Paperclip}</button><button type="button" class="send" aria-label="Send mock message">${icons.ArrowUp}</button></div>`;
function composerMarkup(id, isThumb = false) {
  const items = samples
    .slice(0, 4)
    .map((item) => chip(item, !isThumb))
    .join("");
  const editor =
    id === 1
      ? `<div class="editor" role="textbox" aria-label="Message" aria-multiline="true" contenteditable="true">Please review the onboarding flow ${items} and suggest improvements.</div>`
      : `<textarea class="editor-textarea" aria-label="Message" placeholder="Describe a change">${sampleDraft}</textarea>`;
  const rack = `<div class="chip-row">${items}</div>`;
  let content;
  if (id === 1) content = editor + footer();
  if (id === 2) content = rack + editor + footer();
  if (id === 3) content = editor + `<div class="context-caption">CONTEXT</div>` + rack + footer();
  if (id === 4)
    content = `<div class="composer-layout">${editor}<div class="context-rail"><div class="context-caption">CONTEXT · <span class="count">4</span></div>${rack}<div class="rail-empty" hidden>No context yet</div></div>${footer()}</div>`;
  return `<div class="composer">${content}</div>`;
}
function mockMarkup(id) {
  return `<div class="ade opt-${id}"><div class="ade-top"><span class="ade-mark">A</span><strong>first-steps-forward</strong><span class="sep">/</span><span class="muted-text">Workspace</span></div><div class="ade-tabs"><span class="selected">Conversations</span><span>Files</span><span>Workflows</span><span>Skills</span></div><div class="ade-body"><aside class="ade-sidebar"><div class="side-label">CONVERSATIONS</div><div class="side-active">New conversation</div><div class="side-sub">Onboarding updates</div><div class="side-sub">Improve navigation</div></aside><div class="ade-main"><div><div class="main-title"><div class="eyebrow">FIRST STEPS FORWARD</div><h2>Start a conversation</h2><p>Choose an agent and describe what you want to work on.</p></div><div class="conversation"><strong>Working in your project.</strong> Give your agent context to help it focus on the right files and follow the right workflow.</div></div><div><div class="mock-result" hidden aria-live="polite"></div><div class="composer-wrap"><div class="suggestions" role="listbox" aria-label="Suggestions" hidden></div>${composerMarkup(id)}</div></div></div></div></div>`;
}
function showOverview() {
  $("#cards").innerHTML = options
    .map(
      (o) =>
        `<a class="card" href="#option-${o.id}" aria-label="Open direction ${o.id}: ${o.name}"><div class="card-preview"><div class="thumb opt-${o.id}">${composerMarkup(o.id, true)}</div></div><div class="card-body"><div class="card-title"><span class="number">0${o.id}</span><h3>${o.name}</h3></div><p>${o.tradeoff}</p><span class="card-cta">Explore direction →</span></div></a>`,
    )
    .join("");
}
function createInstance(id) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = mockMarkup(id);
  const root = wrapper.firstElementChild;
  const editor = $(".editor, .editor-textarea", root),
    menu = $(".suggestions", root),
    result = $(".mock-result", root);
  let selected = samples.slice(0, 4).map((s) => s.id),
    active = 0,
    shown = [],
    trigger = null;
  function currentItems() {
    return id === 1
      ? [...editor.querySelectorAll("[data-chip]")].map((el) => el.dataset.chip)
      : selected;
  }
  function updateRack() {
    if (id === 1) return;
    const row = $(".chip-row", root);
    row.innerHTML = selected.map((key) => chip(samples.find((s) => s.id === key))).join("");
    const count = $(".count", root);
    if (count) count.textContent = String(selected.length);
    const empty = $(".rail-empty", root);
    if (empty) empty.hidden = selected.length > 0;
    const caption = $(".context-caption", root);
    if (caption && id === 3) caption.hidden = selected.length === 0;
  }
  function closeMenu() {
    menu.hidden = true;
    trigger = null;
    shown = [];
    active = 0;
  }
  function selectedTextNode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode) || !sel.isCollapsed)
      return null;
    return sel;
  }
  function getTrigger() {
    if (id === 1) {
      const sel = selectedTextNode();
      if (!sel || sel.anchorNode.nodeType !== Node.TEXT_NODE) return null;
      const before = sel.anchorNode.textContent.slice(0, sel.anchorOffset),
        match = /(?:^|\s)([\/@])([^\s@]*)$/.exec(before);
      if (!match) return null;
      return {
        symbol: match[1],
        query: match[2],
        node: sel.anchorNode,
        start: sel.anchorOffset - match[2].length - 1,
        end: sel.anchorOffset,
      };
    }
    const before = editor.value.slice(0, editor.selectionStart),
      match = /(?:^|\s)([\/@])([^\s@]*)$/.exec(before);
    return match
      ? {
          symbol: match[1],
          query: match[2],
          start: editor.selectionStart - match[2].length - 1,
          end: editor.selectionStart,
        }
      : null;
  }
  function showMenu() {
    trigger = getTrigger();
    if (!trigger) {
      closeMenu();
      return;
    }
    const query = trigger.query.toLowerCase();
    shown = samples.filter(
      (item) =>
        (trigger.symbol === "/"
          ? ["skill", "workflow"].includes(item.type)
          : ["file", "folder"].includes(item.type)) &&
        `${item.name} ${item.detail}`.toLowerCase().includes(query),
    );
    active = 0;
    renderMenu();
  }
  function renderMenu() {
    menu.innerHTML =
      `<div class="suggestion-header">${trigger.symbol === "/" ? "WORKFLOWS & SKILLS" : "PROJECT FILES & FOLDERS"}</div>` +
      (shown.length
        ? shown
            .map(
              (item, index) =>
                `<button type="button" role="option" class="suggestion" data-item="${item.id}" aria-selected="${active === index}">${icons[item.icon]}<span>${escapeHTML(item.name)}<small>${escapeHTML(item.type)} · ${escapeHTML(item.detail)}</small></span></button>`,
            )
            .join("")
        : '<div class="empty">No matching sample items</div>');
    menu.hidden = false;
  }
  function choose(item) {
    if (!trigger || !item) return;
    if (id === 1) {
      const range = document.createRange();
      range.setStart(trigger.node, trigger.start);
      range.setEnd(trigger.node, trigger.end);
      range.deleteContents();
      const template = document.createElement("template");
      template.innerHTML = chip(item);
      const pill = template.content.firstElementChild;
      range.insertNode(pill);
      const space = document.createTextNode("\u00a0");
      pill.after(space);
      range.setStartAfter(space);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (item.type === "workflow")
        [...editor.querySelectorAll('[data-chip="' + item.id + '"]')]
          .slice(0, -1)
          .forEach((el) => el.remove());
    } else {
      const before = editor.value.slice(0, trigger.start),
        after = editor.value.slice(trigger.end);
      editor.value = before + after;
      editor.focus();
      editor.setSelectionRange(before.length, before.length);
      if (item.type === "workflow")
        selected = selected.filter((key) => samples.find((s) => s.id === key).type !== "workflow");
      if (!selected.includes(item.id)) selected.push(item.id);
      updateRack();
    }
    closeMenu();
    editor.focus();
  }
  menu.addEventListener("pointerdown", (event) => event.preventDefault());
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-item]");
    if (button) choose(samples.find((s) => s.id === button.dataset.item));
  });
  editor.addEventListener("input", showMenu);
  editor.addEventListener("click", (event) => {
    if (event.target.closest(".remove")) return;
    showMenu();
  });
  editor.addEventListener("keydown", (event) => {
    if (!menu.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && shown.length) {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
        renderMenu();
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && shown.length && !event.shiftKey) {
        event.preventDefault();
        choose(shown[active]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  root.addEventListener("click", (event) => {
    const remove = event.target.closest(".remove");
    if (remove) {
      const item = remove.closest("[data-chip]");
      if (id === 1) item.remove();
      else {
        selected = selected.filter((key) => key !== item.dataset.chip);
        updateRack();
      }
      editor.focus();
      return;
    }
    const symbol = event.target.closest(".slash") ? "/" : event.target.closest(".at") ? "@" : null;
    if (symbol) {
      editor.focus();
      if (id === 1) {
        const sel = selectedTextNode();
        if (sel) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const text = document.createTextNode(" " + symbol);
          range.insertNode(text);
          range.setStart(text, text.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else editor.append(" " + symbol);
      } else {
        const start = editor.selectionStart,
          end = editor.selectionEnd,
          prefix = start && !/\s/.test(editor.value[start - 1]) ? " " : "";
        editor.setRangeText(prefix + symbol, start, end, "end");
      }
      showMenu();
    }
    if (event.target.closest(".send")) send();
  });
  function send() {
    const itemIds = currentItems();
    const text =
      id === 1
        ? [...editor.childNodes]
            .map((node) =>
              node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-chip")
                ? ""
                : node.textContent,
            )
            .join("")
            .replace(/\s+/g, " ")
            .trim()
        : editor.value.trim();
    if (!text && !itemIds.length) return;
    const renderedText =
      id === 1
        ? [...editor.childNodes]
            .map((node) => {
              if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-chip"))
                return chip(
                  samples.find((s) => s.id === node.dataset.chip),
                  false,
                );
              if (node.nodeName === "BR") return "<br>";
              return escapeHTML(node.textContent);
            })
            .join("")
        : escapeHTML(text);
    const renderedChips =
      id === 1
        ? ""
        : `<div class="chip-row">${itemIds
            .map((key) =>
              chip(
                samples.find((s) => s.id === key),
                false,
              ),
            )
            .join("")}</div>`;
    result.innerHTML = `<div class="eyebrow">MOCK MESSAGE · NOT SENT</div><div class="mock-result-text">${renderedText}</div>${renderedChips}`;
    result.hidden = false;
    if (id === 1) editor.innerHTML = "";
    else {
      editor.value = "";
      selected = [];
      updateRack();
    }
    closeMenu();
    editor.focus();
  }
  function reset() {
    if (id === 1) editor.innerHTML = "";
    else {
      editor.value = "";
      selected = [];
      updateRack();
    }
    result.hidden = true;
    result.innerHTML = "";
    closeMenu();
    editor.focus();
  }
  return { root, reset };
}
function renderCloseups(option) {
  $("#closeup-note").textContent = option.note;
  $("#closeups").innerHTML =
    `<div class="closeup"><div class="eyebrow">THE SELECTED COMPONENT</div>${chip(samples[1], false)} ${chip(samples[2], false)}<p>Each item keeps its identity as a skill, file, folder, or workflow.</p></div><div class="closeup"><div class="eyebrow">DISCOVERY</div><div class="closeup-find">${icons.Search}<span>Type <kbd>/</kbd> or <kbd>@</kbd> to search</span></div><p>Use the keyboard or click a result; the draft stays in place.</p></div>`;
}
function navigate() {
  const match = /^#option-([1-4])$/.exec(location.hash),
    overview = $("#overview"),
    detail = $("#detail");
  if (!match) {
    overview.hidden = false;
    detail.hidden = true;
    return;
  }
  const id = Number(match[1]),
    option = options[id - 1];
  overview.hidden = true;
  detail.hidden = false;
  $("#detail-number").textContent = `0${id}`;
  $("#detail-title").textContent = option.name;
  $("#detail-tradeoff").textContent = option.tradeoff;
  const previous = id === 1 ? 4 : id - 1,
    next = id === 4 ? 1 : id + 1;
  for (const selector of ["#previous", "#previous-bottom"])
    $(selector).href = `#option-${previous}`;
  for (const selector of ["#next", "#next-bottom"]) $(selector).href = `#option-${next}`;
  if (!instances.has(id)) instances.set(id, createInstance(id));
  const mount = $("#mock");
  mount.replaceChildren(instances.get(id).root);
  renderCloseups(option);
  window.scrollTo(0, 0);
}
showOverview();
window.addEventListener("hashchange", navigate);
navigate();
$("#reset").addEventListener("click", () => {
  const id = Number(location.hash.split("-")[1]);
  instances.get(id)?.reset();
});
$("#theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme").textContent = dark ? "Light theme" : "Dark theme";
  $("#theme").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
});
