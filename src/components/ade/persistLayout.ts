import { useCallback } from "react";
import type { GroupImperativeHandle, Layout, LayoutChangedMeta } from "react-resizable-panels";

/**
 * Layout persistence for a `Group` from `react-resizable-panels`.
 *
 * The library's built-in `useDefaultLayout` reads `localStorage` via a
 * default-parameter reference at render time, which throws when the build
 * prerenders the app shell (there is no `localStorage` there). This wrapper
 * keeps all storage access inside effects and event callbacks, then applies the
 * persisted layout imperatively through `groupRef.current?.setLayout(...)`.
 *
 * `Group` is uncontrolled — `defaultLayout` only seeds the initial render — so
 * after mount we call `hydrateGroup` once to swap in any stored sizes. Storage
 * is then written only on user-driven changes (`meta.isUserInteraction`), which
 * keeps library recomputations from polluting it.
 *
 * Usage:
 *   const groupRef = useRef<GroupImperativeHandle | null>(null);
 *   const { onLayoutChanged, hydrateGroup } = usePersistedLayout("ade-shell-layout");
 *   useEffect(() => hydrateGroup(groupRef, DEFAULT_LAYOUT), [hydrateGroup]);
 *   <Group groupRef={groupRef} defaultLayout={DEFAULT_LAYOUT} onLayoutChanged={onLayoutChanged}>
 */
export function usePersistedLayout(layoutId: string): {
  onLayoutChanged: (layout: Layout, meta: LayoutChangedMeta) => void;
  hydrateGroup: (ref: { current: GroupImperativeHandle | null }, defaultLayout: Layout) => void;
} {
  // Hydrate the group from storage once after mount. Storage is only ever
  // touched inside the effect, which never runs on the server.
  const hydrateGroup = useCallback(
    (ref: { current: GroupImperativeHandle | null }, defaultLayout: Layout) => {
      const target = ref.current;
      if (!target) return;
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(layoutId);
      } catch {
        // Private mode etc. — fall through to defaults.
      }
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Layout;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
          // Merge so missing panels in storage fall back to defaults (e.g. when
          // a Panel id changed across deploys).
          target.setLayout({ ...defaultLayout, ...parsed });
        }
      } catch {
        // Malformed JSON — ignore and keep defaults.
      }
    },
    [layoutId],
  );

  // Persist only user-initiated changes (`isUserInteraction`) so library
  // recomputations (e.g. collapsed panel restoration) don't pollute storage.
  const onLayoutChanged = useCallback(
    (_next: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      try {
        window.localStorage.setItem(layoutId, JSON.stringify(_next));
      } catch {
        // Storage may be full or disabled; we don't need to surface this.
      }
    },
    [layoutId],
  );

  return { onLayoutChanged, hydrateGroup };
}
