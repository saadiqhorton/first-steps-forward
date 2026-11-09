import { INPUT_BUTTONS, MAX_MODIFIER_MASK, MODIFIER_BITS } from "../shared/browser-contract.mjs";

export const numberOr = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const coded = (code, message) => Object.assign(new Error(message), { code });

/** Protocol modifier bits: alt 1, ctrl 2, meta 4, shift 8. Anything out of 0..15 is 0. */
export function modifiersOf(message) {
  const value = numberOr(message.modifiers);
  return Number.isInteger(value) && value >= 0 && value <= MAX_MODIFIER_MASK ? value : 0;
}

export function editingCommand(key, modifiers) {
  const modifier = modifiers & 0b0111;
  if (modifier !== MODIFIER_BITS.ctrl && modifier !== MODIFIER_BITS.meta) return null;
  const lower = key.toLowerCase();
  const command =
    lower === "c"
      ? "copy"
      : lower === "x"
        ? "cut"
        : modifier !== MODIFIER_BITS.meta
          ? null
          : lower === "a"
            ? "selectAll"
            : lower === "z"
              ? modifiers & MODIFIER_BITS.shift
                ? "redo"
                : "undo"
              : null;
  return command ? { commands: [command] } : null;
}

/** CDP `Input.dispatchMouseEvent` params for a protocol `mouse` message. */
export function mouseEventParams(message) {
  const action = message.action;
  const type =
    action === "down" ? "mousePressed" : action === "up" ? "mouseReleased" : "mouseMoved";
  const button = INPUT_BUTTONS.includes(String(message.button)) ? message.button : "none";
  return {
    type,
    x: numberOr(message.x),
    y: numberOr(message.y),
    button,
    buttons: numberOr(message.buttons),
    clickCount: numberOr(message.clickCount, type === "mouseMoved" ? 0 : 1),
    modifiers: modifiersOf(message),
  };
}

/** CDP `Input.dispatchMouseEvent` params for a protocol `wheel` message. */
export function wheelEventParams(message) {
  return {
    type: "mouseWheel",
    x: numberOr(message.x),
    y: numberOr(message.y),
    deltaX: numberOr(message.deltaX),
    deltaY: numberOr(message.deltaY),
    modifiers: modifiersOf(message),
  };
}

/** CDP `Input.dispatchKeyEvent` params for a protocol `key` message. */
export function keyEventParams(message) {
  const key = typeof message.key === "string" ? message.key : "";
  const code = typeof message.code === "string" ? message.code : "";
  const modifiers = modifiersOf(message);
  if (message.action === "up") return { type: "keyUp", key, code, modifiers };
  const text = typeof message.text === "string" && message.text.length > 0 ? message.text : null;
  return {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code,
    modifiers,
    ...(text ? { text, unmodifiedText: text } : {}),
    ...(editingCommand(key, modifiers) ?? {}),
    windowsVirtualKeyCode: numberOr(
      message.keyCode,
      key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    ),
  };
}

const XDOTOOL_KEYS = {
  ctrl: "Control",
  control: "Control",
  control_l: "Control",
  control_r: "Control",
  shift: "Shift",
  shift_l: "Shift",
  shift_r: "Shift",
  alt: "Alt",
  alt_l: "Alt",
  alt_r: "Alt",
  meta: "Meta",
  super: "Meta",
  super_l: "Meta",
  super_r: "Meta",
  cmd: "Meta",
  win: "Meta",
  enter: "Enter",
  return: "Enter",
  kp_enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  tab: "Tab",
  iso_left_tab: "Tab",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  page_up: "PageUp",
  prior: "PageUp",
  pagedown: "PageDown",
  page_down: "PageDown",
  next: "PageDown",
  home: "Home",
  end: "End",
  minus: "-",
  plus: "+",
  equal: "=",
  period: ".",
  comma: ",",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  grave: "`",
  bracketleft: "[",
  bracketright: "]",
};
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Turns computer_key's xdotool-style keys into Playwright chords, in order. */
export function xdotoolChords(keys) {
  const combos = typeof keys === "string" ? keys.split(/\s+/).filter(Boolean) : keys;
  if (
    !Array.isArray(combos) ||
    combos.length === 0 ||
    !combos.every((k) => typeof k === "string" && k)
  ) {
    throw new Error('keys is required, e.g. "ctrl+l" or ["Return"]');
  }
  return combos.map((combo) => {
    const parts = combo === "+" ? ["+"] : combo.split("+").filter(Boolean);
    if (parts.length === 0) throw new Error(`Empty key combo: "${combo}"`);
    const names = parts.map((part) => {
      const mapped = XDOTOOL_KEYS[part.toLowerCase()];
      if (mapped) return mapped;
      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase();
      if ([...part].length === 1) return part;
      throw new Error(`Unknown key: ${part}`);
    });
    const modified = names.slice(0, -1).some((name) => MODIFIER_KEYS.has(name));
    const last = names.at(-1);
    if (modified && /^[a-z]$/i.test(last)) names[names.length - 1] = `Key${last.toUpperCase()}`;
    else if (modified && /^[0-9]$/.test(last)) names[names.length - 1] = `Digit${last}`;
    return names.join("+");
  });
}
