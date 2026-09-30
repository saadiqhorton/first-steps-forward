import { Link, useNavigate } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
} from "react-resizable-panels";
import {
  Menu,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { isActive, useAde } from "@/lib/ade/store";
import { RightPaneHostContext } from "./rightPaneContext";
import { usePersistedLayout } from "./persistLayout";

const SHELL_LAYOUT_ID = "ade-shell-layout";
const SHELL_PANEL_IDS = ["shell-sidebar", "shell-main", "shell-right"] as const;
type ShellPanelId = (typeof SHELL_PANEL_IDS)[number];

// Default layout when the user hasn't persisted anything yet.
// Sidebar ~14%, main takes the rest, right pane ~18% (≈ 300 px on a 1700-wide screen).
const DEFAULT_LAYOUT: Layout = { "shell-sidebar": 14, "shell-main": 68, "shell-right": 18 };
const SIDEBAR_MIN_PX = 200;
const SIDEBAR_MAX_PX = 480;
const RIGHT_MIN_PX = 240;
const RIGHT_MAX_PX = 540;
const SIDEBAR_REST_PCT = 14;
const RIGHT_REST_PCT = 18;

const NAV = [
  { to: "/", label: "Home" },
  { to: "/history", label: "History" },
  { to: "/processes", label: "Processes" },
  { to: "/agents", label: "Agents" },
] as const;

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
  // `data-orientation` follows react-resizable-panels' own convention so the
  // stylesheet can apply the right width/cursor and wider hit area.
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
          // Keep the chevron visible when the panel is collapsed so the restore
          // affordance is always discoverable; otherwise reveal on hover.
          data-always-visible={collapsed ? "true" : undefined}
        >
          {side === "left" ? (
            collapsed ? (
              <PanelLeftOpen className="size-3.5" aria-hidden strokeWidth={2.5} />
            ) : (
              <PanelLeftClose className="size-3.5" aria-hidden strokeWidth={2.5} />
            )
          ) : side === "right" ? (
            collapsed ? (
              <PanelRightOpen className="size-3.5" aria-hidden strokeWidth={2.5} />
            ) : (
              <PanelRightClose className="size-3.5" aria-hidden strokeWidth={2.5} />
            )
          ) : collapsed ? (
            <PanelBottomOpen className="size-3.5" aria-hidden strokeWidth={2.5} />
          ) : (
            <PanelBottomClose className="size-3.5" aria-hidden strokeWidth={2.5} />
          )}
        </button>
      )}
    </Separator>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  // Host element for the right column. Routes portal their preview into it, so
  // there's no cross-tree state to keep in sync (and no render loop).
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
  const { state, selectProject } = useAde();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "editor" | "terminal">("preview");
  const [editorOpened, setEditorOpened] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [terminalClosing, setTerminalClosing] = useState(false);
  const [terminalCloseError, setTerminalCloseError] = useState("");
  const previewTabRef = useRef<HTMLButtonElement | null>(null);
  const editorTabRef = useRef<HTMLButtonElement | null>(null);
  const terminalCloseRef = useRef<(() => Promise<void>) | null>(null);
  const registerTerminalClose = useCallback((close: (() => Promise<void>) | null) => {
    terminalCloseRef.current = close;
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
      setRightTab((current) => (current === "terminal" ? "preview" : current));
      setTerminalOpened(false);
      (rightTab === "editor" ? editorTabRef : previewTabRef).current?.focus();
    } catch (error) {
      setTerminalCloseError(
        `${error instanceof Error ? error.message : "Could not close terminal."} Click X to retry.`,
      );
    } finally {
      setTerminalClosing(false);
    }
  };
  const [HostEditor, setHostEditor] = useState<ComponentType<{
    projectId: string;
    projectName: string;
    projectPath: string;
  }> | null>(null);
  const [HostTerminal, setHostTerminal] = useState<ComponentType<{
    projectId: string;
    projectName: string;
    projectPath: string;
    visible: boolean;
    registerClose: (close: (() => Promise<void>) | null) => void;
  }> | null>(null);
  const terminalProject =
    state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];

  useEffect(() => {
    if (!editorOpened) return;
    let active = true;
    import("./HostEditorPane").then(({ HostEditorPane }) => {
      if (active) setHostEditor(() => HostEditorPane);
    });
    return () => {
      active = false;
    };
  }, [editorOpened]);
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
  const isDesktop = useIsDesktop();
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  // SSR-safe persistence: hydrate from storage after mount and persist on
  // user-driven changes only (`isUserInteraction`). See `persistLayout.ts`.
  const { onLayoutChanged: onShellLayoutChanged, hydrateGroup } =
    usePersistedLayout(SHELL_LAYOUT_ID);
  useEffect(() => {
    hydrateGroup(groupRef, DEFAULT_LAYOUT);
  }, [hydrateGroup]);

  // Imperative toggle: expand a collapsed Panel back to its rest size, or
  // collapse it to 0. The main Panel absorbs/gives up the difference so the
  // three sizes always total 100%. Uses the live layout, not assumptions.
  const togglePanel = useCallback((panelId: ShellPanelId, restPct: number) => {
    const current = groupRef.current?.getLayout();
    if (!current) return;
    const cur = current[panelId] ?? 0;
    const curMain = current["shell-main"] ?? 0;
    if (cur < 1) {
      // Expand: reserve the rest size for this panel, leave the others as-is.
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
      // Collapse: hand this panel's space to the main Panel.
      groupRef.current?.setLayout({ ...current, [panelId]: 0, "shell-main": curMain + cur });
    }
  }, []);
  const toggleSidebar = useCallback(
    () => togglePanel("shell-sidebar", SIDEBAR_REST_PCT),
    [togglePanel],
  );
  const toggleRight = useCallback(() => togglePanel("shell-right", RIGHT_REST_PCT), [togglePanel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ to: "/tasks/new" });
      }
      // ⌘\ (or Ctrl+\) toggles the sidebar so users can quickly reclaim
      // horizontal space without leaving the keyboard.
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggleRight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleSidebar, toggleRight]);

  // Track collapsed state so the seam's chevron button can switch its icon.
  const [collapsed, setCollapsed] = useState({
    sidebar: false,
    right: false,
  });
  const onSidebarResize = (size: { asPercentage: number }) =>
    setCollapsed((c) =>
      c.sidebar === (size.asPercentage === 0) ? c : { ...c, sidebar: size.asPercentage === 0 },
    );
  const onRightResize = (size: { asPercentage: number }) =>
    setCollapsed((c) =>
      c.right === (size.asPercentage === 0) ? c : { ...c, right: size.asPercentage === 0 },
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      <div className="flex h-9 shrink-0 items-center justify-between bg-ink/90 px-3 text-paper sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-controls="ade-sidebar"
            aria-label={navOpen ? "Close projects menu" : "Open projects menu"}
            className="-ml-1 grid size-7 shrink-0 place-items-center rounded text-paper/70 hover:bg-white/10 hover:text-paper focus-visible:outline-2 focus-visible:outline-amber lg:hidden"
          >
            {navOpen ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Menu className="size-4" aria-hidden />
            )}
          </button>
          <span className="truncate font-mono text-[11px] uppercase tracking-[0.18em]">
            ADE · local-first agent workspace
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-4 font-mono text-[11px] text-paper/60">
          {state.hydrated && !state.serviceAvailable && (
            <span className="text-amber">Local service disconnected</span>
          )}
          <span className="hidden sm:inline">⌘K new task</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {!isDesktop && (
          <>
            {/* Mobile: off-canvas overlay sidebar (kept identical to the
                previous mobile behavior so small screens keep their gestures). */}
            <aside
              id="ade-sidebar"
              className={`fixed top-9 bottom-0 left-0 z-40 w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel transition-transform duration-200 ${
                navOpen ? "flex translate-x-0" : "hidden -translate-x-full"
              }`}
              aria-label="Projects"
            >
              <SidebarBody onNavigate={() => setNavOpen(false)} />
            </aside>
            {navOpen && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Close projects menu"
                onClick={() => setNavOpen(false)}
                className="fixed top-9 right-0 bottom-0 left-0 z-30 bg-ink/40"
              />
            )}
          </>
        )}

        {isDesktop && (
          /* Desktop: resizable sidebar + main + right pane. */
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
              id="shell-sidebar"
              collapsible
              collapsedSize={0}
              minSize={`${SIDEBAR_MIN_PX}px`}
              maxSize={`${SIDEBAR_MAX_PX}px`}
              style={{ minWidth: 0, overflow: "hidden" }}
              onResize={onSidebarResize}
            >
              <SidebarBody />
            </Panel>
            <PanelSash
              orientation="vertical"
              panelId="shell-sidebar"
              side="left"
              onToggleCollapsed={toggleSidebar}
              collapsed={collapsed.sidebar}
              collapseLabel="Hide projects"
              expandLabel="Show projects"
            />
            <Panel id="shell-main" style={{ minWidth: 0, overflow: "hidden" }} minSize="40%">
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>
            </Panel>
            <PanelSash
              orientation="vertical"
              panelId="shell-right"
              side="right"
              onToggleCollapsed={toggleRight}
              collapsed={collapsed.right}
              collapseLabel="Hide preview pane"
              expandLabel="Show preview pane"
            />
            <Panel
              id="shell-right"
              collapsible
              collapsedSize={0}
              minSize={`${RIGHT_MIN_PX}px`}
              maxSize={`${RIGHT_MAX_PX}px`}
              style={{ minWidth: 0, overflow: "hidden" }}
              onResize={onRightResize}
            >
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div
                  role="tablist"
                  aria-label="Right panel"
                  className="flex h-9 shrink-0 border-b border-line bg-panel px-2"
                >
                  <button
                    type="button"
                    role="tab"
                    id="right-preview-tab"
                    ref={previewTabRef}
                    aria-selected={rightTab === "preview"}
                    aria-controls="right-preview-panel"
                    onClick={() => setRightTab("preview")}
                    className={`border-b-2 px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${rightTab === "preview" ? "border-amber text-ink" : "border-transparent text-dim hover:text-ink"}`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="right-editor-tab"
                    ref={editorTabRef}
                    aria-selected={rightTab === "editor"}
                    aria-controls="right-editor-panel"
                    onClick={() => {
                      setEditorOpened(true);
                      setRightTab("editor");
                    }}
                    className={`border-b-2 px-2 font-mono text-[10px] uppercase tracking-[0.12em] ${rightTab === "editor" ? "border-amber text-ink" : "border-transparent text-dim hover:text-ink"}`}
                  >
                    Editor
                  </button>
                  {terminalOpened ? (
                    <div
                      className={`flex items-center border-b-2 ${rightTab === "terminal" ? "border-amber text-ink" : "border-transparent text-dim"}`}
                    >
                      <button
                        type="button"
                        role="tab"
                        id="right-terminal-tab"
                        aria-selected={rightTab === "terminal"}
                        aria-controls="right-terminal-panel"
                        onClick={() => setRightTab("terminal")}
                        className="h-full pl-3 pr-1 font-mono text-[10px] uppercase tracking-[0.12em] hover:text-ink"
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
                      className="ml-auto flex items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
                    >
                      <span aria-hidden>›_</span> Terminal
                    </button>
                  )}
                </div>
                <div
                  id="right-preview-panel"
                  role="tabpanel"
                  aria-labelledby="right-preview-tab"
                  className={`min-h-0 flex-1 ${rightTab === "preview" ? "flex" : "hidden"}`}
                >
                  <div
                    ref={onRightHostChange}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                    aria-label="Preview"
                  />
                </div>
                <div
                  id="right-editor-panel"
                  role="tabpanel"
                  aria-labelledby="right-editor-tab"
                  className={`min-h-0 min-w-0 flex-1 overflow-hidden ${rightTab === "editor" ? "flex" : "hidden"}`}
                >
                  {editorOpened && terminalProject && HostEditor ? (
                    <HostEditor
                      key={terminalProject.id}
                      projectId={terminalProject.id}
                      projectName={terminalProject.name}
                      projectPath={terminalProject.path}
                    />
                  ) : (
                    <div className="grid flex-1 place-items-center bg-[#fbf8f1] px-5 text-center font-mono text-[11px] text-dim">
                      {terminalProject ? "Opening editor…" : "Add a project to browse files."}
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
                    {terminalProject && HostTerminal ? (
                      <HostTerminal
                        key={terminalProject.id}
                        projectId={terminalProject.id}
                        projectName={terminalProject.name}
                        projectPath={terminalProject.path}
                        visible={rightTab === "terminal"}
                        registerClose={registerTerminalClose}
                      />
                    ) : (
                      <div className="grid flex-1 place-items-center bg-[#1d2928] px-5 text-center font-mono text-[11px] text-white/60">
                        {terminalProject
                          ? "Opening terminal…"
                          : "Add a project to open a terminal."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </Group>
        )}

        {!isDesktop && (
          /* Narrow layouts: single column with the route content. The sidebar
             is the off-canvas overlay above; the right pane is omitted. */
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between bg-ink px-4 text-paper/55">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
          ADE — start with the task · Codex · OpenCode · Pi Agent
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
          Loopback only · No ADE account · No hosted service
        </span>
      </footer>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { state, selectProject } = useAde();
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-panel">
      <div className="px-4 pt-5 pb-2">
        <div className="font-display text-2xl leading-none tracking-wide">Projects</div>
        <div className="label-mono mt-1 tracking-[0.16em]">
          {state.projects.length} on this machine
        </div>
      </div>
      <div className="space-y-1 px-3">
        {state.projects.map((p) => {
          const active = p.id === state.activeProjectId;
          const sessions = state.sessions.filter((s) => s.projectId === p.id && isActive(s));
          const running = state.processes.some(
            (x) => x.projectId === p.id && (x.status === "running" || x.status === "starting"),
          );
          return (
            <button
              key={p.id}
              onClick={() => {
                onNavigate?.();
                selectProject(p.id);
                navigate({ to: "/" });
              }}
              aria-current={active ? "true" : undefined}
              className={`w-full overflow-hidden rounded-md px-3 py-2 text-left transition-colors ${active ? "bg-amber/10 ring-1 ring-amber/25" : "hover:bg-ink/[0.04]"}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${running ? "bg-teal" : "bg-dim"}`}
                  aria-hidden
                />
                <span className={`min-w-0 truncate text-[13px] ${active ? "font-medium" : ""}`}>
                  {p.name}
                </span>
                {sessions.length > 0 && (
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
                    {sessions.length}
                  </span>
                )}
              </div>
              <div className="mt-1 break-all font-mono text-[10px] leading-snug text-dim">
                {p.path}
                {p.missing ? " · missing" : ""}
              </div>
            </button>
          );
        })}
        <Link
          to="/projects/add"
          onClick={() => onNavigate?.()}
          className="block rounded-md px-3 py-2 text-[12px] text-dim hover:bg-ink/[0.04] hover:text-ink"
        >
          + Add project
        </Link>
      </div>

      <nav className="mt-6 px-3" aria-label="Workspace">
        <div className="label-mono px-3 pb-1 tracking-[0.16em]">Workspace</div>
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            activeProps={{ className: "bg-ink/[0.06] font-medium" }}
            onClick={() => onNavigate?.()}
            className="block rounded-md px-3 py-1.5 text-[13px] hover:bg-ink/[0.04]"
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto p-3">
        <div className="rounded-md bg-ink px-3 py-2 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/70">
            Open source · free
          </span>
        </div>
      </div>
    </div>
  );
}
