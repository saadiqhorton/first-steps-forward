// Preview shortcuts follow T3 Code's default preview keybindings.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, type RefObject } from "react";

interface BrowserShortcutActions {
  frameRef: RefObject<HTMLElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  enabled: boolean;
  refresh: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

/** Handle preview shortcuts only while focus is inside the browser pane. */
export function useBrowserShortcuts(actions: BrowserShortcutActions) {
  const current = useRef(actions);
  current.current = actions;

  useEffect(() => {
    const consumed = new Set<string>();
    const keydown = (event: KeyboardEvent) => {
      const { frameRef, inputRef, enabled, refresh, zoomIn, zoomOut, resetZoom } = current.current;
      if (!enabled || !(event.target instanceof Node) || !frameRef.current?.contains(event.target))
        return;
      const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      if ((mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) || event.altKey)
        return;

      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      if (!event.shiftKey && key === "l") {
        action = () => {
          inputRef.current?.focus();
          inputRef.current?.select();
        };
      } else if (!event.shiftKey && key === "r") action = refresh;
      else if (key === "=" || key === "+") action = zoomIn;
      else if (!event.shiftKey && key === "-") action = zoomOut;
      else if (!event.shiftKey && key === "0") action = resetZoom;
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();
      consumed.add(event.code);
      if (!event.repeat) action();
    };
    const keyup = (event: KeyboardEvent) => {
      if (!consumed.delete(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const clear = () => consumed.clear();
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", clear);
    };
  }, []);
}
