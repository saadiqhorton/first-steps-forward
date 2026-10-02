import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
} from "react-resizable-panels";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { RightTab } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";
import { AddProjectDialog } from "./AddProjectDialog";
import { AgentsDialog } from "./AgentsDialog";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { GlideIndicator, SectionFade } from "./motion";
import { AgentComputerPane } from "./AgentComputerPane";
import { RightPaneHostContext } from "./rightPaneContext";
import { SectionTabs } from "./SectionTabs";
import { ShellContext, type ShellDialog } from "./shellContext";
import { migrateDefaultLayout } from "./migrateDefaultLayout.mjs";
import { TopBar } from "./TopBar";
import { usePersistedLayout } from "./persistLayout";

const SHELL_LAYOUT_ID = "ade-shell-layout-v2";
const SHELL_PANEL_IDS = ["shell-main", "shell-right"] as const;
type ShellPanelId = (typeof SHELL_PANEL_IDS)[number];

// Split desk: give the live computer a useful starting size beside the task.
// Persisted user layouts still take precedence when the group hydrates.
const DEFAULT_LAYOUT: Layout = { "shell-main": 56, "shell-right": 44 };
const PREVIOUS_DEFAULT_LAYOUT: Layout = { "shell-main": 74, "shell-right": 26 };
const RIGHT_MIN_PX = 240;
/** Allow Diff/Activity to grow until main hits its 40% floor. */
const RIGHT_MAX_PCT = 60;
const RIGHT_REST_PCT = 44;

const RIGHT_TABS: RightTab[] = ["activity", "diff", "computer", "terminal"];

/**
 * Tracks whether we're on the `lg` breakpoint or wider. Renders `true` on the
 * server and during the first client render (so hydration matches), then
 * reconciles in an effect. The desktop `Group` sets `display: flex` inline
 * itself, so we can't hide it with the Tailwind `hidden` class — we choose
 * which layout to mount instead to avoid rendering the sidebar twice.
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
          ) : null}
        </button>
      )}
    </Separator>
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
  const activityTabRef = useRef<HTMLButtonElement | null>(null);
  const diffTabRef = useRef<HTMLButtonElement | null>(null);
  const computerTabRef = useRef<HTMLButtonElement | null>(null);
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
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const { onLayoutChanged: onShellLayoutChanged, hydrateGroup } =
    usePersistedLayout(SHELL_LAYOUT_ID);
  useEffect(() => {
    // Move only the exact prior default. Resized and collapsed user layouts are
    // preserved, while returning users get the approved split desk once.
    try {
      const stored = window.localStorage.getItem(SHELL_LAYOUT_ID);
      const migrated = migrateDefaultLayout(stored, PREVIOUS_DEFAULT_LAYOUT, DEFAULT_LAYOUT);
      if (migrated !== stored && migrated) window.localStorage.setItem(SHELL_LAYOUT_ID, migrated);
    } catch {
      // The layout hook falls back to DEFAULT_LAYOUT when storage is unavailable.
    }
    hydrateGroup(groupRef, DEFAULT_LAYOUT);
  }, [hydrateGroup]);

  const togglePanel = useCallback((panelId: ShellPanelId, restPct: number) => {
    const current = groupRef.current?.getLayout();
    if (!current) return;
    const cur = current[panelId] ?? 0;
    const curMain = current["shell-main"] ?? 0;
    if (cur < 1) {
      const others = SHELL_PANEL_IDS.filter((id) => id !== panelId && id !== "shell-main").reduce(
        (sum, id) => sum + (current[id] ?? 0),
        0,
      );
      groupRef.current?.setLayout({
        ...current,
        [panelId]: restPct,
        "shell-main": Math.max(0, 100 - restPct - others),
      });
    } else {
      groupRef.current?.setLayout({ ...current, [panelId]: 0, "shell-main": curMain + cur });
    }
  }, []);
  const toggleRight = useCallback(() => togglePanel("shell-right", RIGHT_REST_PCT), [togglePanel]);

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

  const [collapsedRight, setCollapsedRight] = useState(false);
  const onRightResize = (size: { asPercentage: number }) =>
    setCollapsedRight((c) => (c === (size.asPercentage === 0) ? c : size.asPercentage === 0));

  const shellContextValue = {
    rightTab,
    setRightTab,
    openDialog,
    toggleList,
    registerListToggle,
  };

  const tabClass = (active: boolean) =>
    `relative px-3 text-sm transition-colors ${active ? "text-ink" : "text-dim hover:text-ink"}`;
  const tabIndicator = (
    <GlideIndicator
      id="right-pane-tab"
      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-amber"
    />
  );

  const rightPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="Right panel"
        className="flex h-9 shrink-0 border-b border-line bg-panel px-2"
      >
        <button
          type="button"
          role="tab"
          id="right-activity-tab"
          ref={activityTabRef}
          aria-selected={rightTab === "activity"}
          aria-controls="right-session-panel"
          onClick={() => setRightTab("activity")}
          className={tabClass(rightTab === "activity")}
        >
          Activity
          {rightTab === "activity" && tabIndicator}
        </button>
        <button
          type="button"
          role="tab"
          id="right-diff-tab"
          ref={diffTabRef}
          aria-selected={rightTab === "diff"}
          aria-controls="right-session-panel"
          onClick={() => setRightTab("diff")}
          className={tabClass(rightTab === "diff")}
        >
          Diff
          {rightTab === "diff" && tabIndicator}
        </button>
        <button
          type="button"
          role="tab"
          id="right-computer-tab"
          ref={computerTabRef}
          aria-selected={rightTab === "computer"}
          aria-controls="right-computer-panel"
          onClick={() => setRightTab("computer")}
          className={tabClass(rightTab === "computer")}
        >
          Computer
          {rightTab === "computer" && tabIndicator}
        </button>
        {terminalOpened ? (
          <div
            className={`relative flex items-center transition-colors ${rightTab === "terminal" ? "text-ink" : "text-dim"}`}
          >
            {rightTab === "terminal" && tabIndicator}
            <button
              type="button"
              role="tab"
              id="right-terminal-tab"
              aria-selected={rightTab === "terminal"}
              aria-controls="right-terminal-panel"
              onClick={() => setRightTab("terminal")}
              className="h-full pl-3 pr-1 text-sm hover:text-ink"
            >
              Terminal
            </button>
            <button
              type="button"
              aria-label="Close terminal tab"
              title="Close terminal"
              onClick={() => void closeTerminal()}
              disabled={terminalClosing}
              className="mx-1 grid size-5 place-items-center rounded text-dim hover:bg-ink/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openTerminal}
            aria-label="Open terminal"
            className="ml-auto flex items-center gap-1.5 px-2 text-sm text-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <span aria-hidden>›_</span> Terminal
          </button>
        )}
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
          <AgentComputerPane project={activeProject} session={activeSession} />
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
    </div>
  );

  return (
    <ShellContext.Provider value={shellContextValue}>
      <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
        <TopBar isDesktop={isDesktop} />
        <SectionTabs />

        <div className="flex min-h-0 flex-1">
          {isDesktop ? (
            <Group
              id={SHELL_LAYOUT_ID}
              groupRef={groupRef}
              orientation="horizontal"
              defaultLayout={DEFAULT_LAYOUT}
              onLayoutChanged={onShellLayoutChanged}
              style={{ flex: 1, minHeight: 0 }}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel
                id="shell-main"
                className="min-w-0 overflow-hidden"
                style={{ minWidth: 0, overflow: "hidden" }}
                minSize="40%"
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
                className="min-w-0 overflow-hidden"
                collapsible
                collapsedSize={0}
                minSize={`${RIGHT_MIN_PX}px`}
                maxSize={`${RIGHT_MAX_PCT}%`}
                style={{ minWidth: 0, overflow: "hidden" }}
                onResize={onRightResize}
              >
                {rightPane}
              </Panel>
            </Group>
          ) : (
            <SectionFade
              sectionKey={sectionKey}
              className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
            >
              {children}
            </SectionFade>
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
    </ShellContext.Provider>
  );
}
