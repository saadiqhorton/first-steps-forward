import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type GroupImperativeHandle,
  type Layout,
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
const AUTO_COLLAPSE_THRESHOLD = 720;

function ConversationsLayout() {
  const { registerListToggle } = useShell();
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const groupElementRef = useRef<HTMLDivElement | null>(null);
  const listPanelRef = usePanelRef();
  const { onLayoutChanged, hydrateGroup } = usePersistedLayout(LAYOUT_ID);
  const [collapsedList, setCollapsedList] = useState(false);
  const autoCollapsedRef = useRef(false);
  const prevNarrowRef = useRef(false);

  useEffect(() => {
    hydrateGroup(groupRef, DEFAULT_LAYOUT);
  }, [hydrateGroup]);

  const toggleList = useCallback(() => {
    const current = groupRef.current?.getLayout();
    if (!current) return;
    const cur = current[LIST_PANEL] ?? 0;
    const curMain = current[MAIN_PANEL] ?? 0;
    if (cur < 1) {
      groupRef.current?.setLayout({
        ...current,
        [LIST_PANEL]: LIST_REST_PCT,
        [MAIN_PANEL]: Math.max(0, 100 - LIST_REST_PCT),
      });
    } else {
      groupRef.current?.setLayout({
        ...current,
        [LIST_PANEL]: 0,
        [MAIN_PANEL]: curMain + cur,
      });
    }
    // User manually toggled, reset auto-collapse tracking
    autoCollapsedRef.current = false;
  }, []);

  useEffect(() => {
    registerListToggle(toggleList);
    return () => registerListToggle(null);
  }, [registerListToggle, toggleList]);

  const onListResize = (size: { asPercentage: number }) =>
    setCollapsedList((c) => (c === (size.asPercentage === 0) ? c : size.asPercentage === 0));

  // Auto-collapse when Group width crosses threshold
  useEffect(() => {
    const groupElement = groupElementRef.current;
    if (!groupElement) return;

    const observer = new ResizeObserver(() => {
      const width = groupElement.offsetWidth;
      const isNarrow = width < AUTO_COLLAPSE_THRESHOLD;

      if (isNarrow && !prevNarrowRef.current) {
        if (!listPanelRef.current?.isCollapsed()) {
          listPanelRef.current?.collapse();
          autoCollapsedRef.current = true;
        }
      } else if (!isNarrow && prevNarrowRef.current && autoCollapsedRef.current) {
        if (listPanelRef.current?.isCollapsed()) {
          listPanelRef.current?.expand();
          autoCollapsedRef.current = false;
        }
      }

      prevNarrowRef.current = isNarrow;
    });

    observer.observe(groupElement);
    return () => observer.disconnect();
  }, [listPanelRef]);

  return (
    <div ref={groupElementRef} style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
      <Group
        id={LAYOUT_ID}
        groupRef={groupRef}
        orientation="horizontal"
        defaultLayout={DEFAULT_LAYOUT}
        onLayoutChanged={onLayoutChanged}
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        className="min-h-0 min-w-0 flex-1"
      >
        <Panel
          panelRef={listPanelRef}
          id={LIST_PANEL}
          className="min-w-0 overflow-hidden"
          collapsible
          collapsedSize={0}
          minSize={`${LIST_MIN_PX}px`}
          maxSize={`${LIST_MAX_PX}px`}
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
          minSize="360px"
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </Panel>
      </Group>
    </div>
  );
}
