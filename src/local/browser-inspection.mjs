// Element picking follows T3 Code's PickPreload.ts and PickedElementPayload contract.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

/** Runs inside the preview page through Playwright's evaluate. */
export function inspectElementAt({ x, y, region }) {
  const describe = (element) => {
    if (!element || element === document.documentElement || element === document.body) return null;

    // IDs are only unique within a tree, so retain the host path across each shadow root.
    // Playwright's selector chaining pierces open shadow roots when applying style previews.
    const paths = [];
    let rootElement = element;
    while (rootElement) {
      const segments = [];
      for (
        let node = rootElement;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        if (node.id) {
          segments.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        let segment = node.tagName.toLowerCase();
        const classes = Array.from(node.classList).slice(0, 2);
        if (classes.length) segment += classes.map((name) => `.${CSS.escape(name)}`).join("");
        const parent = node.parentElement ?? node.parentNode;
        if (parent && "children" in parent) {
          const siblings = Array.from(parent.children).filter(
            (item) => item.tagName === node.tagName,
          );
          if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        segments.unshift(segment);
      }
      if (segments.length) paths.unshift(segments.join(" > "));
      const root = rootElement.getRootNode();
      rootElement = root instanceof ShadowRoot ? root.host : null;
    }
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left);
    let top = Math.max(0, box.top);
    let right = Math.min(document.documentElement.clientWidth, box.right);
    let bottom = Math.min(document.documentElement.clientHeight, box.bottom);
    if (getComputedStyle(element).position !== "fixed") {
      for (
        let node = element,
          ancestor =
            node.parentElement ??
            (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
        ancestor;
        node = ancestor,
          ancestor =
            node.parentElement ??
            (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null)
      ) {
        if (ancestor === document.body || ancestor === document.documentElement) break;
        const ancestorStyle = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (ancestorStyle.overflowX !== "visible") {
          left = Math.max(left, bounds.left + ancestor.clientLeft);
          right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (ancestorStyle.overflowY !== "visible") {
          top = Math.max(top, bounds.top + ancestor.clientTop);
          bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
    }
    const clone = element.cloneNode(true);
    if (clone instanceof Element) {
      for (const input of [clone, ...clone.querySelectorAll("input, textarea")]) {
        if (input instanceof HTMLInputElement) input.removeAttribute("value");
        if (input instanceof HTMLTextAreaElement) input.textContent = "";
      }
    }
    const style = getComputedStyle(element);
    const properties = [
      "display",
      "position",
      "color",
      "background-color",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "width",
      "height",
      "padding",
      "margin",
      "gap",
      "border",
      "border-color",
      "border-width",
      "border-radius",
      "opacity",
    ];
    const styles = properties.map((name) => `${name}: ${style.getPropertyValue(name)};`).join(" ");
    let componentName = null;
    let source = null;
    try {
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      let fiber = fiberKey ? element[fiberKey] : null;
      for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
        const type = fiber.type;
        if (!componentName && typeof type === "function")
          componentName = type.displayName || type.name || null;
        const debug = fiber._debugSource;
        if (debug?.fileName) {
          source = {
            fileName: debug.fileName,
            lineNumber: debug.lineNumber ?? null,
            columnNumber: debug.columnNumber ?? null,
          };
          break;
        }
      }
    } catch {
      // React metadata is optional and may not be exposed in a production build.
    }
    return {
      pageUrl: location.href,
      pageTitle: document.title || null,
      tagName: element.tagName.toLowerCase(),
      selector: paths.join(" >> ") || null,
      htmlPreview: clone instanceof Element ? clone.outerHTML.slice(0, 500) : "",
      styles,
      componentName,
      source,
      rect: {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      },
    };
  };

  if (region) {
    const descendants = (root) => {
      const items = Array.from(root.querySelectorAll("*"));
      return items.flatMap((item) => [
        item,
        ...(item.shadowRoot ? descendants(item.shadowRoot) : []),
      ]);
    };
    return descendants(document.body)
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ element, box }) => {
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        if (centerX < 0 || centerY < 0 || centerX > innerWidth || centerY > innerHeight)
          return false;
        for (let ancestor = element; ancestor;) {
          const style = getComputedStyle(ancestor);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
            return false;
          if (ancestor !== element) {
            const bounds = ancestor.getBoundingClientRect();
            if (
              (style.overflowX !== "visible" &&
                (centerX < bounds.left + ancestor.clientLeft ||
                  centerX > bounds.left + ancestor.clientLeft + ancestor.clientWidth)) ||
              (style.overflowY !== "visible" &&
                (centerY < bounds.top + ancestor.clientTop ||
                  centerY > bounds.top + ancestor.clientTop + ancestor.clientHeight))
            )
              return false;
          }
          const root = ancestor.getRootNode();
          ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
        }
        return (
          box.width >= 2 &&
          box.height >= 2 &&
          centerX >= region.x &&
          centerX <= region.x + region.width &&
          centerY >= region.y &&
          centerY <= region.y + region.height &&
          ((element.children.length === 0 && !element.shadowRoot?.children.length) ||
            element instanceof HTMLButtonElement ||
            element instanceof HTMLAnchorElement ||
            element.getAttribute("role") === "button")
        );
      })
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)
      .slice(0, 20)
      .map(({ element, box }) => ({
        element: describe(element),
        center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      }))
      .filter(({ element }) => element);
  }
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return describe(element);
}
