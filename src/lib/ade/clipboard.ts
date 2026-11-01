/**
 * Clipboard writes that survive the ADE's LAN mode.
 *
 * `navigator.clipboard` is only exposed in a secure context, so a browser that
 * opened the ADE at `http://192.168.x.x:3100` (or a plain-http Tailscale IP)
 * has no Clipboard API at all and `navigator.clipboard.writeText` throws. The
 * legacy selection + `execCommand("copy")` path still works on insecure
 * origins, so use it as the fallback instead of telling the user to copy the
 * text by hand.
 */

/** True when this origin exposes the async Clipboard API (https or loopback). */
export function hasAsyncClipboard(): boolean {
  if (!window.isSecureContext) return false;
  return typeof navigator.clipboard?.writeText === "function";
}

/** True when the page is on an origin where the browser withholds the Clipboard API. */
export function isInsecureOrigin(): boolean {
  return !window.isSecureContext;
}

function copyWithSelection(text: string): boolean {
  if (!document.body) return false;
  const active = document.activeElement;
  const previous = document.getSelection();
  const saved = previous && previous.rangeCount > 0 ? previous.getRangeAt(0) : null;

  // Off-screen but focusable: `select()` needs a rendered field, opacity keeps it invisible.
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.tabIndex = -1;
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(field);

  let copied = false;
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    if (saved && previous) {
      previous.removeAllRanges();
      previous.addRange(saved);
    }
  }
  return copied;
}

/**
 * Writes `text` to the clipboard. Resolves false when the browser refuses, so
 * callers can offer a manual fallback instead of claiming success.
 */
export async function copyText(text: string): Promise<boolean> {
  if (hasAsyncClipboard()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Focus or permission refusal: the selection path is the last resort.
    }
  }
  return copyWithSelection(text);
}
