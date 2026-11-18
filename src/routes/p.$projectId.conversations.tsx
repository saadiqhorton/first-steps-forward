import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type GroupImperativeHandle,
  type Layout,
  type LayoutChangedMeta,
} from "react-resizable-panels";
import { z } from "zod";
import { ConversationList } from "@/components/ade/ConversationList";
import { usePersistedLayout } from "@/components/ade/persistLayout";
import { useShell } from "@/components/ade/shellContext";
import { RIGHT_TABS, type RightTab } from "@/lib/ade/navigation";

const rightTabs = ["editor", ...RIGHT_TABS] as const satisfies readonly (RightTab | "editor")[];

const conversationsSearchSchema = z.object({
  completed: z.boolean().optional(),
  pane: z.enum(rightTabs).optional(),
  dialog: z.enum(["agents", "add-project"]).optional(),
});

export type ConversationsSearch = z.infer<typeof conversationsSearchSchema>;

export const Route = createFileRoute("/p/$projectId/conversations")({
  validateSearch: (search: Record<string, unknown>): ConversationsSearch => {
    const completedRaw = search["completed"];
    const completed =
      completedRaw === true || completedRaw === "true"
        ? true
        : completedRaw === false || completedRaw === "false"
          ? false
          : undefined;
    const parsed = conversationsSearchSchema.safeParse({
      completed,
      // The agent computer replaced the Preview tab; keep old links working.
      pane: search["pane"] === "preview" ? "computer" : search["pane"],
      dialog: search["dialog"],
    });
    return parsed.success ? parsed.data : {};
  },
  component: ConversationsLayout,
});

const LAYOUT_ID = "ade-conversations-layout";
const LIST_PANEL = "conversations-list";
const MAIN_PANEL = "conversations-main";
const LIST_REST_PCT = 24;
const DEFAULT_LAYOUT: Layout = { [LIST_PANEL]: 24, [MAIN_PANEL]: 76 };
const LIST_MIN_PX = 240;
const LIST_MAX_PX = 440;
const MAIN_MIN_PX = 360;
const AUTO_COLLAPSE_THRESHOLD = 720;
const LIST_WIDTH_KEY = "ade-conversations-list-width";

/** Persist the list in pixels so resizing the other pane cannot rescale it. */
function readListWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(LIST_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeListWidth(px: number): void {
  try {
    localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(px)));
  } catch {
    // Private mode / quota: keep the in-memory layout.
  }
}

/** The nested project split should only be measured when the shell pane is shown. */
function projectPaneVisible(): boolean {
  if (typeof document === "undefined") return false;
  if (document.body.classList.contains("shell-full-width")) return false;
  const right = document.querySelector('[data-testid="shell-right"]');
  return !right || getComputedStyle(right).display !== "none";
}

/** Below the auto-collapse breakpoint the split becomes one-pane-at-a-time. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_THRESHOLD - 1}px)`);
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return narrow;
}

function ConversationsLayout() {
  const { registerListToggle } = useShell();
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const groupElementRef = useRef<HTMLDivElement | null>(null);
  const listPanelRef = usePanelRef();
  const { onLayoutChanged, hydrateGroup } = usePersistedLayout(LAYOUT_ID);
  const [collapsedList, setCollapsedList] = useState(false);
  const autoCollapsedRef = useRef(false);
  const prevNarrowRef = useRef(false);
  const hydratedRef = useRef(false);
  const isNarrow = useIsNarrow();

  const applyListPx = useCallback((px: number) => {
    const group = groupRef.current;
    const element = groupElementRef.current;
    if (!group || !element) return false;
    const total = element.offsetWidth;
    if (!projectPaneVisible() || total <= 0) return false;
    const maxForMain = Math.max(LIST_MIN_PX, total - MAIN_MIN_PX);
    const clamped = Math.min(Math.max(px, LIST_MIN_PX), Math.min(LIST_MAX_PX, maxForMain));
    const percentage = (clamped / total) * 100;
    group.setLayout({
      ...group.getLayout(),
      [LIST_PANEL]: percentage,
      [MAIN_PANEL]: 100 - percentage,
    });
    return true;
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    const saved = readListWidth();
    if (!saved) {
      hydratedRef.current = true;
      hydrateGroup(groupRef, DEFAULT_LAYOUT);
      return;
    }
    // On client-side navigation the Group can mount one frame before it has a
    // measurable width. Retry until the saved pixel width can be applied.
    let cancelled = false;
    let frames = 0;
    const attempt = () => {
      if (cancelled || hydratedRef.current) return;
      if (applyListPx(saved)) {
        hydratedRef.current = true;
        return;
      }
      if (frames++ < 30) requestAnimationFrame(attempt);
      else {
        hydratedRef.current = true;
        hydrateGroup(groupRef, DEFAULT_LAYOUT);
      }
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [applyListPx, hydrateGroup]);

  const expandList = useCallback(() => {
    if (isNarrow) {
      const group = groupRef.current;
      if (!group) return;
      // One pane at a time: the list owns the full nested group.
      group.setLayout({ ...group.getLayout(), [LIST_PANEL]: 100, [MAIN_PANEL]: 0 });
      return;
    }
    const total = groupElementRef.current?.offsetWidth ?? 0;
    const fallback = Math.max(LIST_MIN_PX, Math.round((total * LIST_REST_PCT) / 100));
    applyListPx(readListWidth() ?? fallback);
  }, [applyListPx, isNarrow]);

  const toggleList = useCallback(() => {
    const panel = listPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) expandList();
    else panel.collapse();
    // User manually toggled, reset auto-collapse tracking
    autoCollapsedRef.current = false;
  }, [expandList, listPanelRef]);

  useEffect(() => {
    registerListToggle(toggleList);
    return () => registerListToggle(null);
  }, [registerListToggle, toggleList]);

  const onListResize = (size: { asPercentage: number }) =>
    setCollapsedList((c) => (c === (size.asPercentage === 0) ? c : size.asPercentage === 0));

  const handleLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      onLayoutChanged(layout, meta);
      if (!meta.isUserInteraction || isNarrow) return;
      const total = groupElementRef.current?.offsetWidth;
      const percentage = layout[LIST_PANEL] ?? 0;
      // A collapsed list must not overwrite the last expanded width.
      if (total && percentage > 0) writeListWidth((percentage / 100) * total);
    },
    [isNarrow, onLayoutChanged],
  );

  // Auto-collapse when Group width crosses threshold
  useEffect(() => {
    const groupElement = groupElementRef.current;
    if (!groupElement) return;

    const observer = new ResizeObserver(() => {
      const width = groupElement.offsetWidth;
      const isNowNarrow = width < AUTO_COLLAPSE_THRESHOLD;

      if (isNowNarrow && !prevNarrowRef.current) {
        if (!listPanelRef.current?.isCollapsed()) {
          listPanelRef.current?.collapse();
          autoCollapsedRef.current = true;
        }
      } else if (!isNowNarrow && prevNarrowRef.current) {
        const current = groupRef.current?.getLayout();
        const listPercentage = current?.[LIST_PANEL] ?? 0;
        // Restore a desktop width when the window grows again, including the
        // one-pane mobile layout the user opened manually.
        if (autoCollapsedRef.current || listPercentage >= 99) {
          const fallback = Math.max(LIST_MIN_PX, Math.round((width * LIST_REST_PCT) / 100));
          applyListPx(readListWidth() ?? fallback);
          autoCollapsedRef.current = false;
        }
      }

      prevNarrowRef.current = isNowNarrow;
    });

    observer.observe(groupElement);
    return () => observer.disconnect();
  }, [applyListPx, listPanelRef]);

  return (
    <div ref={groupElementRef} style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
      <Group
        id={LAYOUT_ID}
        groupRef={groupRef}
        orientation="horizontal"
        defaultLayout={DEFAULT_LAYOUT}
        onLayoutChanged={handleLayoutChanged}
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        className="min-h-0 min-w-0 flex-1"
      >
        <Panel
          panelRef={listPanelRef}
          id={LIST_PANEL}
          className="min-w-0 overflow-hidden"
          collapsible
          collapsedSize={0}
          minSize={isNarrow ? "0px" : `${LIST_MIN_PX}px`}
          maxSize={isNarrow ? "100%" : `${LIST_MAX_PX}px`}
          groupResizeBehavior="preserve-pixel-size"
          style={{ minWidth: 0, overflow: "hidden" }}
          onResize={onListResize}
        >
          <ConversationList />
        </Panel>
        <Separator id="seam-conversations-list" className="panel-seam" data-orientation="vertical">
          <button
            type="button"
            aria-label={collapsedList ? "Show conversation list" : "Hide conversation list"}
            title={collapsedList ? "Show conversation list" : "Hide conversation list"}
            aria-expanded={!collapsedList}
            aria-controls={LIST_PANEL}
            onClick={toggleList}
            className="panel-collapse-handle"
            data-always-visible={collapsedList ? "true" : undefined}
          />
        </Separator>
        <Panel
          id={MAIN_PANEL}
          className="min-w-0 overflow-hidden"
          style={{ minWidth: 0, overflow: "hidden" }}
          minSize={isNarrow ? "0px" : `${MAIN_MIN_PX}px`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </Panel>
      </Group>
    </div>
  );
}
