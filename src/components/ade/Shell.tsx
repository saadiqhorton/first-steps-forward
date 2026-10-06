import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  PanelBottom,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { RightTab } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";
import { AddProjectDialog } from "./AddProjectDialog";
import { AgentsDialog } from "./AgentsDialog";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { SectionFade } from "./motion";
import { AgentComputerPane } from "./AgentComputerPane";
import { RightPaneHostContext } from "./rightPaneContext";
import { RightPaneTabs } from "./RightPaneTabs";
import { RightRail } from "./RightRail";
import type { ComputerTone, RightDock } from "./rightPaneTypes";
import { SectionTabs } from "./SectionTabs";
import { ShellContext, type ShellDialog } from "./shellContext";
import { migrateDefaultLayout } from "./migrateDefaultLayout.mjs";
import { TopBar } from "./TopBar";
import { usePersistedLayout } from "./persistLayout";

const SHELL_LAYOUT_ID = "ade-shell-layout-v2";
const BOTTOM_LAYOUT_ID = "ade-shell-layout-bottom";
const DOCK_PREF_KEY = "ade-right-dock";
const SHELL_PANEL_IDS = ["shell-main", "shell-right"] as const;
type ShellPanelId = (typeof SHELL_PANEL_IDS)[number];

// Split desk: give the live computer a useful starting size beside the task.
// Persisted user layouts still take precedence when the group hydrates.
const DEFAULT_LAYOUT: Layout = { "shell-main": 56, "shell-right": 44 };
const PREVIOUS_DEFAULT_LAYOUT: Layout = { "shell-main": 74, "shell-right": 26 };
const DEFAULT_LAYOUT_BOTTOM: Layout = { "shell-main": 62, "shell-right": 38 };
const RIGHT_MIN_PX = 300;
/** Allow Diff/Activity to grow until main hits its floor. */
const RIGHT_MAX_PCT = 60;
const BOTTOM_MIN_PX = 180;
const BOTTOM_MAX_PCT = 70;
const COLLAPSED_SIZE = "40px";

const RIGHT_TABS: RightTab[] = ["activity", "diff", "computer", "terminal"];

/**
 * Tracks whether we're on the `lg` breakpoint or wider. Renders `true` on the
 * server and during the first client render (so hydration matches), then
 * reconciles in an effect.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return isDesktop;
}

function PanelSash({
  orientation,
  panelId,
  side,
  onToggleCollapsed,
  collapsed,
  collapseLabel,
  expandLabel,
  showCollapseHandle = true,
}: {
  orientation: "vertical" | "horizontal";
  panelId: ShellPanelId | "session-bottom";
  side: "left" | "right" | "bottom";
  onToggleCollapsed?: () => void;
  collapsed?: boolean;
  collapseLabel?: string;
  expandLabel?: string;
  showCollapseHandle?: boolean;
}) {
  const label = collapsed ? (expandLabel ?? "Expand panel") : (collapseLabel ?? "Collapse panel");
  return (
    <Separator id={`seam-${panelId}`} className="panel-seam" data-orientation={orientation}>
      {showCollapseHandle && onToggleCollapsed && (
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-expanded={!collapsed}
          aria-controls={String(panelId)}
          onClick={onToggleCollapsed}
          className="panel-collapse-handle"
          data-always-visible={collapsed ? "true" : undefined}
        >
          {side === "right" ? (
            collapsed ? (
              <PanelRightOpen className="size-3.5" aria-hidden strokeWidth={2.5} />
            ) : (
              <PanelRightClose className="size-3.5" aria-hidden strokeWidth={2.5} />
            )
          ) : side === "bottom" ? (
            collapsed ? (
              <PanelBottomOpen className="size-3.5" aria-hidden strokeWidth={2.5} />
            ) : (
              <PanelBottomClose className="size-3.5" aria-hidden strokeWidth={2.5} />
            )
          ) : null}
        </button>
      )}
    </Separator>
  );
}

/**
 * Appends a persistent DOM node (owned by `ShellInner`) into this Panel and
 * removes it on cleanup. The node itself is never destroyed, so whatever
 * React portals into it (terminal, computer viewer) survives being moved
 * between the side-docked and bottom-docked Panels.
 */
function PaneSlot({ el }: { el: HTMLDivElement }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.appendChild(el);
    return () => {
      if (el.parentNode === container) container.removeChild(el);
    };
  }, [el]);
  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    />
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [rightHost, setRightHost] = useState<HTMLDivElement | null>(null);
  return (
    <RightPaneHostContext.Provider value={rightHost}>
      <ShellInner onRightHostChange={setRightHost}>{children}</ShellInner>
    </RightPaneHostContext.Provider>
  );
}

function ShellInner({
  children,
  onRightHostChange,
}: {
  children: ReactNode;
  onRightHostChange: (host: HTMLDivElement | null) => void;
}) {
  const { state } = useAde();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Animate the section that is actually rendered. Requested location changes
  // before pending route code loads, while matches still show the outgoing page.
  const sectionKey = useRouterState({
    select: (s) =>
      (s.matches.at(-1)?.pathname ?? s.resolvedLocation?.pathname ?? "/")
        .split("/")
        .slice(0, 4)
        .join("/"),
  });
  const activeSessionId = useRouterState({
    select: (s) => (s.matches.at(-1)?.params as { sessionId?: string } | undefined)?.sessionId,
  });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const [rightTab, setRightTab] = useState<RightTab>("computer");
  const [dialog, setDialog] = useState<ShellDialog | null>(null);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [terminalClosing, setTerminalClosing] = useState(false);
  const [terminalCloseError, setTerminalCloseError] = useState("");
  const [computerTone, setComputerTone] = useState<ComputerTone>("idle");
  const activityTabRef = useRef<HTMLButtonElement | null>(null);
  const sessionPaneActive = rightTab === "activity" || rightTab === "diff";
  const terminalCloseRef = useRef<(() => Promise<void>) | null>(null);
  const listToggleRef = useRef<(() => void) | null>(null);

  const registerTerminalClose = useCallback((close: (() => Promise<void>) | null) => {
    terminalCloseRef.current = close;
  }, []);

  const openDialog = useCallback((d: ShellDialog) => setDialog(d), []);
  const toggleList = useCallback(() => {
    listToggleRef.current?.();
  }, []);
  const registerListToggle = useCallback((fn: (() => void) | null) => {
    listToggleRef.current = fn;
  }, []);

  const openTerminal = () => {
    setTerminalCloseError("");
    setTerminalOpened(true);
    setRightTab("terminal");
  };
  const closeTerminal = async () => {
    if (terminalClosing) return;
    setTerminalClosing(true);
    setTerminalCloseError("");
    try {
      await terminalCloseRef.current?.();
      setRightTab((current) => (current === "terminal" ? "activity" : current));
      setTerminalOpened(false);
      activityTabRef.current?.focus();
    } catch (error) {
      setTerminalCloseError(
        `${error instanceof Error ? error.message : "Could not close terminal."} Click X to retry.`,
      );
    } finally {
      setTerminalClosing(false);
    }
  };

  // Selecting a tab opens the terminal session on first use; otherwise just switches.
  const selectTab = (tab: "activity" | "diff" | "computer" | "terminal") => {
    if (tab === "terminal" && !terminalOpened) {
      openTerminal();
      return;
    }
    setRightTab(tab);
  };

  const [HostTerminal, setHostTerminal] = useState<ComponentType<{
    projectId: string;
    projectName: string;
    projectPath: string;
    visible: boolean;
    registerClose: (close: (() => Promise<void>) | null) => void;
  }> | null>(null);

  const activeProject =
    state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];
  const activeSession = state.sessions.find(
    (session) => session.id === activeSessionId && session.projectId === activeProject?.id,
  );

  useEffect(() => {
    if (!terminalOpened) return;
    let active = true;
    import("./HostTerminalPane").then(({ HostTerminalPane }) => {
      if (active) setHostTerminal(() => HostTerminalPane);
    });
    return () => {
      active = false;
    };
  }, [terminalOpened]);

  // Consume `pane` / `dialog` search params once, then strip them from the URL.
  useEffect(() => {
    // The agent computer replaced the Preview tab; keep old links working.
    const paneRaw = search["pane"] === "preview" ? "computer" : search["pane"];
    const dialogRaw = search["dialog"];
    const obsoleteEditor = paneRaw === "editor";
    const pane =
      typeof paneRaw === "string" && (RIGHT_TABS as string[]).includes(paneRaw)
        ? (paneRaw as RightTab)
        : undefined;
    const nextDialog =
      dialogRaw === "agents" || dialogRaw === "add-project" ? dialogRaw : undefined;
    if (!pane && !nextDialog && !obsoleteEditor) return;

    if (pane) {
      if (pane === "terminal") setTerminalOpened(true);
      setRightTab(pane);
    }
    if (nextDialog) setDialog(nextDialog);

    // Strip across heterogeneous route search schemas (Shell sits above all routes).
    const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
    params.delete("pane");
    params.delete("dialog");
    const nextSearch = params.toString();
    router.history.replace(`${pathname}${nextSearch ? `?${nextSearch}` : ""}`);
  }, [search, searchStr, pathname, router]);

  const isDesktop = useIsDesktop();

  // Dock preference: "side" or "bottom", persisted in localStorage. Below the
  // desktop breakpoint the pane is always bottom-docked, regardless of pref.
  const [dockPref, setDockPref] = useState<RightDock>("side");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DOCK_PREF_KEY);
      if (stored === "side" || stored === "bottom") setDockPref(stored);
    } catch {
      // Private mode etc. — keep the default.
    }
  }, []);
  const setDock = useCallback((next: RightDock) => {
    setDockPref(next);
    try {
      window.localStorage.setItem(DOCK_PREF_KEY, next);
    } catch {
      // Storage may be full or disabled; the in-memory pref still applies.
    }
  }, []);
  const effectiveDock: RightDock = isDesktop ? dockPref : "bottom";

  const sideGroupRef = useRef<GroupImperativeHandle | null>(null);
  const bottomGroupRef = useRef<GroupImperativeHandle | null>(null);
  const sidePanelRef = useRef<PanelImperativeHandle | null>(null);
  const bottomPanelRef = useRef<PanelImperativeHandle | null>(null);
  const activePanelRef = effectiveDock === "side" ? sidePanelRef : bottomPanelRef;

  const { onLayoutChanged: onSideLayoutChanged, hydrateGroup: hydrateSideGroup } =
    usePersistedLayout(SHELL_LAYOUT_ID);
  const { onLayoutChanged: onBottomLayoutChanged, hydrateGroup: hydrateBottomGroup } =
    usePersistedLayout(BOTTOM_LAYOUT_ID);

  // Hydrate whichever Group is current, on mount and whenever the dock changes
  // (switching dock swaps in a differently-keyed Group, which remounts fresh).
  useEffect(() => {
    if (effectiveDock === "side") {
      // Move only the exact prior default. Resized and collapsed user layouts
      // are preserved, while returning users get the approved split desk once.
      try {
        const stored = window.localStorage.getItem(SHELL_LAYOUT_ID);
        const migrated = migrateDefaultLayout(stored, PREVIOUS_DEFAULT_LAYOUT, DEFAULT_LAYOUT);
        if (migrated !== stored && migrated) window.localStorage.setItem(SHELL_LAYOUT_ID, migrated);
      } catch {
        // The layout hook falls back to DEFAULT_LAYOUT when storage is unavailable.
      }
      hydrateSideGroup(sideGroupRef, DEFAULT_LAYOUT);
    } else {
      hydrateBottomGroup(bottomGroupRef, DEFAULT_LAYOUT_BOTTOM);
    }
    // Old layouts could persist the right panel at 0 (fully hidden). With the
    // new rail, 0 — or anything short of the min size — must resolve to a
    // clean collapse instead of an under-sized panel. Measuring needs a frame.
    const panelRef = effectiveDock === "side" ? sidePanelRef : bottomPanelRef;
    const minPx = effectiveDock === "side" ? RIGHT_MIN_PX : BOTTOM_MIN_PX;
    requestAnimationFrame(() => {
      const size = panelRef.current?.getSize();
      if (size && size.inPixels < minPx) panelRef.current?.collapse();
    });
  }, [effectiveDock, hydrateSideGroup, hydrateBottomGroup]);

  const [collapsedRight, setCollapsedRight] = useState(false);

  const expandRight = useCallback(() => {
    activePanelRef.current?.expand();
  }, [activePanelRef]);
  const collapseRight = useCallback(() => {
    activePanelRef.current?.collapse();
  }, [activePanelRef]);
  const toggleRight = useCallback(() => {
    if (activePanelRef.current?.isCollapsed()) activePanelRef.current.expand();
    else activePanelRef.current?.collapse();
  }, [activePanelRef]);
  // Rail tabs both select and expand.
  const railSelect = (tab: "activity" | "diff" | "computer" | "terminal") => {
    selectTab(tab);
    expandRight();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (activeProject?.id) {
          void navigate({
            to: "/p/$projectId/conversations",
            params: { projectId: activeProject.id },
          });
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleList();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggleRight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleList, toggleRight, activeProject?.id]);

  const shellContextValue = {
    rightTab,
    setRightTab,
    openDialog,
    toggleList,
    registerListToggle,
  };

  // One persistent element, created on the client after mount, that holds the
  // whole pane body. It's portaled into and then DOM-reparented (via
  // `PaneSlot`) into whichever Panel is current, so switching dock or
  // collapsing never unmounts the terminal session or the computer viewer
  // inside it. Starting from `null` keeps the first client render identical
  // to the server's (which never has a `document`), avoiding a hydration
  // mismatch; the element appears a tick later, once mounted.
  const [paneEl, setPaneEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.className = "flex h-full min-h-0 min-w-0 flex-col overflow-hidden";
    setPaneEl(el);
  }, []);

  const dockToggle = isDesktop && (
    <button
      type="button"
      aria-label={dockPref === "side" ? "Dock to bottom" : "Dock to side"}
      title={dockPref === "side" ? "Dock to bottom" : "Dock to side"}
      onClick={() => setDock(dockPref === "side" ? "bottom" : "side")}
      className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
    >
      {dockPref === "side" ? (
        <PanelBottom className="size-3.5" aria-hidden />
      ) : (
        <PanelRight className="size-3.5" aria-hidden />
      )}
    </button>
  );
  const collapseButton = (
    <button
      type="button"
      aria-label="Collapse right panel"
      title="Collapse right panel"
      onClick={collapseRight}
      className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
    >
      {effectiveDock === "side" ? (
        <PanelRightClose className="size-3.5" aria-hidden />
      ) : (
        <PanelBottomClose className="size-3.5" aria-hidden />
      )}
    </button>
  );

  const paneContent = (
    <>
      {/* Actions live outside RightPaneTabs' own overflow-x-auto tab row so
          the collapse button can never scroll out of view on a narrow pane.
          RightPaneTabs nests its `role=tablist` row a level deep (inside a
          `@container` div), so `[&_[role=tablist]]:border-b-0` reaches in and
          drops its inner border — this wrapper's border is the only one drawn. */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-panel [&_[role=tablist]]:border-b-0">
        <div className="min-w-0 flex-1">
          <RightPaneTabs
            tab={rightTab}
            onSelect={selectTab}
            terminalOpened={terminalOpened}
            terminalClosing={terminalClosing}
            onCloseTerminal={closeTerminal}
            activityTabRef={activityTabRef}
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pr-1.5 pl-1">
          {dockToggle}
          {collapseButton}
        </div>
      </div>

      <div
        id="right-session-panel"
        role="tabpanel"
        aria-labelledby={rightTab === "diff" ? "right-diff-tab" : "right-activity-tab"}
        className={`min-h-0 flex-1 ${sessionPaneActive ? "flex" : "hidden"}`}
      >
        <div
          ref={onRightHostChange}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          aria-label={rightTab === "diff" ? "Diff" : "Activity"}
        />
      </div>

      <div
        id="right-computer-panel"
        role="tabpanel"
        aria-labelledby="right-computer-tab"
        className={`min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto ${rightTab === "computer" ? "flex" : "hidden"}`}
      >
        {activeProject ? (
          <AgentComputerPane
            project={activeProject}
            session={activeSession}
            dock={effectiveDock}
            onToneChange={setComputerTone}
          />
        ) : (
          <div className="grid flex-1 place-items-center px-5 text-center font-mono text-[11px] text-dim">
            Add a project to give agents a computer.
          </div>
        )}
      </div>

      {terminalOpened && (
        <div
          id="right-terminal-panel"
          role="tabpanel"
          aria-labelledby="right-terminal-tab"
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${rightTab === "terminal" ? "flex" : "hidden"}`}
        >
          {terminalCloseError && (
            <div
              role="alert"
              className="absolute bottom-10 left-3 right-3 z-10 border border-[#e1ad61]/40 bg-[#282320] px-2 py-1 font-mono text-[10px] text-[#e1ad61]"
            >
              {terminalCloseError}
            </div>
          )}
          {activeProject && HostTerminal ? (
            <HostTerminal
              key={activeProject.id}
              projectId={activeProject.id}
              projectName={activeProject.name}
              projectPath={activeProject.path}
              visible={rightTab === "terminal"}
              registerClose={registerTerminalClose}
            />
          ) : (
            <div className="grid flex-1 place-items-center bg-[#1d2928] px-5 text-center font-mono text-[11px] text-white/60">
              <TextShimmer active={!!activeProject}>
                {activeProject ? "Opening terminal…" : "Add a project to open a terminal."}
              </TextShimmer>
            </div>
          )}
        </div>
      )}
    </>
  );

  const railOrientation = effectiveDock === "side" ? "vertical" : "horizontal";
  const rail = (
    <RightRail
      orientation={railOrientation}
      tab={rightTab}
      computerTone={computerTone}
      onSelect={railSelect}
      onExpand={expandRight}
      dock={effectiveDock}
    />
  );

  // Collapsed panel body: the portaled pane content stays mounted (just
  // hidden) so the terminal/computer never reconnect, while the rail — kept
  // outside the portal so it renders directly in the Panel — takes its place.
  const panelBody = (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        className={
          collapsedRight ? "hidden" : "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        }
      >
        {paneEl && <PaneSlot el={paneEl} />}
      </div>
      {collapsedRight && rail}
    </div>
  );

  return (
    <ShellContext.Provider value={shellContextValue}>
      <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
        <TopBar isDesktop={isDesktop} />
        <SectionTabs />

        <div className="flex min-h-0 flex-1">
          {effectiveDock === "side" ? (
            <Group
              key={SHELL_LAYOUT_ID}
              id={SHELL_LAYOUT_ID}
              groupRef={sideGroupRef}
              orientation="horizontal"
              defaultLayout={DEFAULT_LAYOUT}
              onLayoutChanged={onSideLayoutChanged}
              style={{ flex: 1, minHeight: 0 }}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel
                id="shell-main"
                className="min-w-0 overflow-hidden"
                style={{ minWidth: 0, overflow: "hidden" }}
                minSize="480px"
              >
                <SectionFade
                  sectionKey={sectionKey}
                  className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  {children}
                </SectionFade>
              </Panel>
              <PanelSash
                orientation="vertical"
                panelId="shell-right"
                side="right"
                onToggleCollapsed={toggleRight}
                collapsed={collapsedRight}
                collapseLabel="Hide right pane"
                expandLabel="Show right pane"
              />
              <Panel
                id="shell-right"
                panelRef={sidePanelRef}
                className="min-w-0 overflow-hidden"
                collapsible
                collapsedSize={COLLAPSED_SIZE}
                minSize={`${RIGHT_MIN_PX}px`}
                maxSize={`${RIGHT_MAX_PCT}%`}
                style={{ minWidth: 0, overflow: "hidden" }}
                onResize={() => setCollapsedRight(sidePanelRef.current?.isCollapsed() ?? false)}
              >
                {panelBody}
              </Panel>
            </Group>
          ) : (
            <Group
              key={BOTTOM_LAYOUT_ID}
              id={BOTTOM_LAYOUT_ID}
              groupRef={bottomGroupRef}
              orientation="vertical"
              defaultLayout={DEFAULT_LAYOUT_BOTTOM}
              onLayoutChanged={onBottomLayoutChanged}
              style={{ flex: 1, minHeight: 0 }}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel
                id="shell-main"
                className="min-w-0 overflow-hidden"
                style={{ minWidth: 0, overflow: "hidden" }}
                minSize="200px"
              >
                <SectionFade
                  sectionKey={sectionKey}
                  className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  {children}
                </SectionFade>
              </Panel>
              <PanelSash
                orientation="horizontal"
                panelId="shell-right"
                side="bottom"
                onToggleCollapsed={toggleRight}
                collapsed={collapsedRight}
                collapseLabel="Hide bottom panel"
                expandLabel="Show bottom panel"
              />
              <Panel
                id="shell-right"
                panelRef={bottomPanelRef}
                className="min-w-0 overflow-hidden"
                collapsible
                collapsedSize={COLLAPSED_SIZE}
                minSize={`${BOTTOM_MIN_PX}px`}
                maxSize={`${BOTTOM_MAX_PCT}%`}
                style={{ minWidth: 0, overflow: "hidden" }}
                onResize={() => setCollapsedRight(bottomPanelRef.current?.isCollapsed() ?? false)}
              >
                {panelBody}
              </Panel>
            </Group>
          )}
        </div>

        <AddProjectDialog
          open={dialog === "add-project"}
          onOpenChange={(open) => setDialog(open ? "add-project" : null)}
        />
        <AgentsDialog
          open={dialog === "agents"}
          onOpenChange={(open) => setDialog(open ? "agents" : null)}
        />
      </div>
      {paneEl && createPortal(paneContent, paneEl)}
    </ShellContext.Provider>
  );
}
