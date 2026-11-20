import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type LayoutChangedMeta,
} from "react-resizable-panels";
import { X } from "lucide-react";
import { FilesExplorer } from "@/components/ade/files/FilesExplorer";
import { FilesHome } from "@/components/ade/files/FilesHome";
import { clearEditorDraft, listDirtyDraftPaths } from "@/components/ade/files/editorDrafts";
import { createEditorFile, deleteEditorFile } from "@/lib/ade/editorApi";
import { editorFileIcon } from "@/components/ade/files/editorIcons";
import { MediaTab } from "@/components/ade/files/MediaTab";
import { mediaKindOf } from "@/shared/media-types.mjs";
import { askConfirm } from "@/lib/ade/userNotices";
import { usePersistedLayout } from "@/components/ade/persistLayout";

const FileTab = lazy(() =>
  import("@/components/ade/files/FileTab").then((module) => ({ default: module.FileTab })),
);

export const Route = createFileRoute("/p/$projectId/files")({
  head: () => ({ meta: [{ title: "Files — ADE" }] }),
  component: FilesPage,
});

const LAYOUT_ID = "ade-files-layout";
const EXPLORER_PANEL = "files-explorer";
const MAIN_PANEL = "files-main";
const DEFAULT_LAYOUT: Layout = { [EXPLORER_PANEL]: 22, [MAIN_PANEL]: 78 };
const EXPLORER_MIN_PX = 200;
const EXPLORER_MAX_PX = 420;
const MAIN_MIN_PCT = 40;
const EXPLORER_WIDTH_KEY = "ade-files-explorer-width";

function readExplorerWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(EXPLORER_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function projectPaneVisible(): boolean {
  if (typeof document === "undefined") return false;
  if (document.body.classList.contains("shell-full-width")) return false;
  const right = document.querySelector('[data-testid="shell-right"]');
  return !right || getComputedStyle(right).display !== "none";
}

function writeExplorerWidth(px: number): void {
  try {
    localStorage.setItem(EXPLORER_WIDTH_KEY, String(Math.round(px)));
  } catch {
    // Private mode / quota: keep the in-memory layout.
  }
}

type TabsState = { open: string[]; active: "home" | string };

function tabsStorageKey(projectId: string) {
  return `ade-files-tabs:${projectId}`;
}

function readTabs(projectId: string): TabsState {
  try {
    const raw = sessionStorage.getItem(tabsStorageKey(projectId));
    if (!raw) return { open: [], active: "home" };
    const parsed = JSON.parse(raw) as Partial<TabsState>;
    const open = Array.isArray(parsed.open)
      ? parsed.open.filter((path): path is string => typeof path === "string")
      : [];
    const active =
      parsed.active === "home" ||
      (typeof parsed.active === "string" && open.includes(parsed.active))
        ? parsed.active
        : "home";
    return { open, active };
  } catch {
    return { open: [], active: "home" };
  }
}

function writeTabs(projectId: string, state: TabsState) {
  try {
    sessionStorage.setItem(tabsStorageKey(projectId), JSON.stringify(state));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function FilesPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const groupElementRef = useRef<HTMLDivElement | null>(null);
  const hydratedRef = useRef(false);
  const { onLayoutChanged, hydrateGroup } = usePersistedLayout(LAYOUT_ID);
  const [tabs, setTabs] = useState<TabsState>(() => readTabs(projectId));
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(
    () => new Set(listDirtyDraftPaths(projectId, readTabs(projectId).open)),
  );
  const [revealFolder, setRevealFolder] = useState<string | null>(null);
  const [entriesRevision, setEntriesRevision] = useState(0);

  const applyExplorerPx = useCallback((px: number) => {
    const group = groupRef.current;
    const element = groupElementRef.current;
    if (!group || !element) return false;
    const total = element.offsetWidth;
    if (!projectPaneVisible() || total <= 0) return false;
    const maxForMain = Math.max(EXPLORER_MIN_PX, (total * (100 - MAIN_MIN_PCT)) / 100);
    const clamped = Math.min(Math.max(px, EXPLORER_MIN_PX), Math.min(EXPLORER_MAX_PX, maxForMain));
    const percentage = (clamped / total) * 100;
    group.setLayout({
      ...group.getLayout(),
      [EXPLORER_PANEL]: percentage,
      [MAIN_PANEL]: 100 - percentage,
    });
    return true;
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    const saved = readExplorerWidth();
    if (!saved) {
      hydratedRef.current = true;
      hydrateGroup(groupRef, DEFAULT_LAYOUT);
      return;
    }
    let cancelled = false;
    let frames = 0;
    const attempt = () => {
      if (cancelled || hydratedRef.current) return;
      if (applyExplorerPx(saved)) {
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
  }, [applyExplorerPx, hydrateGroup]);

  const handleLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      onLayoutChanged(layout, meta);
      if (!meta.isUserInteraction) return;
      const total = groupElementRef.current?.offsetWidth;
      const percentage = layout[EXPLORER_PANEL] ?? 0;
      if (total && percentage > 0) writeExplorerWidth((percentage / 100) * total);
    },
    [onLayoutChanged],
  );

  useEffect(() => {
    const next = readTabs(projectId);
    setTabs(next);
    setDirtyPaths(new Set(listDirtyDraftPaths(projectId, next.open)));
    setRevealFolder(null);
  }, [projectId]);

  useEffect(() => {
    writeTabs(projectId, tabs);
  }, [projectId, tabs]);

  useEffect(() => {
    if (dirtyPaths.size === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyPaths.size]);

  const openFile = useCallback((path: string) => {
    setTabs((previous) => {
      const open = previous.open.includes(path) ? previous.open : [...previous.open, path];
      return { open, active: path };
    });
  }, []);

  const goHome = useCallback(() => {
    setTabs((previous) => ({ ...previous, active: "home" }));
  }, []);

  const refreshFileLists = useCallback(
    async (path?: string) => {
      await queryClient.invalidateQueries({ queryKey: ["entries", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["entry-previews", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["document-previews", projectId] });
      if (path) await queryClient.invalidateQueries({ queryKey: ["file", projectId, path] });
      setEntriesRevision((value) => value + 1);
    },
    [projectId, queryClient],
  );

  const forgetFile = useCallback(
    (path: string) => {
      clearEditorDraft(projectId, path);
      setTabs((previous) => {
        const index = previous.open.indexOf(path);
        const open = previous.open.filter((entry) => entry !== path);
        let active = previous.active;
        if (previous.active === path) {
          active = open[Math.min(index, open.length - 1)] ?? "home";
        }
        return { open, active };
      });
      setDirtyPaths((previous) => {
        if (!previous.has(path)) return previous;
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    },
    [projectId],
  );

  const createFile = useCallback(
    async (path: string) => {
      const created = await createEditorFile(projectId, path);
      await refreshFileLists(created.path);
      openFile(created.path);
    },
    [openFile, projectId, refreshFileLists],
  );

  const removeFile = useCallback(
    async (path: string) => {
      const confirmed = await askConfirm({
        title: `Delete ${path}?`,
        description: dirtyPaths.has(path)
          ? "Unsaved changes will be discarded. This cannot be undone."
          : "This cannot be undone.",
        confirmLabel: "Delete",
      });
      if (!confirmed) return false;
      await deleteEditorFile(projectId, path);
      forgetFile(path);
      await refreshFileLists(path);
      return true;
    },
    [dirtyPaths, forgetFile, projectId, refreshFileLists],
  );

  const closeFile = useCallback(
    async (path: string) => {
      if (
        dirtyPaths.has(path) &&
        !(await askConfirm({
          title: `Discard unsaved changes in ${path}?`,
          confirmLabel: "Discard",
        }))
      )
        return;
      forgetFile(path);
    },
    [dirtyPaths, forgetFile],
  );

  const onDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((previous) => {
      const has = previous.has(path);
      if (dirty === has) return previous;
      const next = new Set(previous);
      if (dirty) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const homeActive = tabs.active === "home";

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
          id={EXPLORER_PANEL}
          minSize={`${EXPLORER_MIN_PX}px`}
          maxSize={`${EXPLORER_MAX_PX}px`}
          groupResizeBehavior="preserve-pixel-size"
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          <FilesExplorer
            projectId={projectId}
            activePath={homeActive ? null : tabs.active}
            dirtyPaths={dirtyPaths}
            homeActive={homeActive}
            revealFolder={revealFolder}
            entriesRevision={entriesRevision}
            onOpenFile={openFile}
            onGoHome={goHome}
            onCreateFile={createFile}
            onRemoveFile={removeFile}
          />
        </Panel>
        <Separator id="seam-files-explorer" className="panel-seam" data-orientation="vertical" />
        <Panel id={MAIN_PANEL} style={{ minWidth: 0, overflow: "hidden" }} minSize="40%">
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <div
              className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel"
              aria-label="Open files"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={homeActive}
                onClick={goHome}
                className={`shrink-0 border-b-2 px-3 text-sm ${
                  homeActive
                    ? "border-amber text-ink"
                    : "border-transparent text-dim hover:text-ink"
                }`}
              >
                Home
              </button>
              {tabs.open.map((path) => {
                const active = tabs.active === path;
                return (
                  <div
                    key={path}
                    className={`flex shrink-0 items-stretch border-b-2 ${
                      active ? "border-amber text-ink" : "border-transparent text-dim"
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={path}
                      onClick={() => setTabs((previous) => ({ ...previous, active: path }))}
                      className="flex items-center gap-1.5 pl-3 pr-1 font-mono text-caption hover:text-ink"
                    >
                      {editorFileIcon(path)}
                      <span>{path.split("/").at(-1)}</span>
                      {dirtyPaths.has(path) && (
                        <span className="ed-dirty-dot" aria-label="Unsaved changes" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${path}`}
                      title={`Close ${path}`}
                      onClick={() => closeFile(path)}
                      className="mr-1 grid size-5 place-items-center self-center rounded text-dim hover:bg-ink/10 hover:text-ink"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className={`${homeActive ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
              <FilesHome
                projectId={projectId}
                onOpenFile={openFile}
                onRevealFolder={setRevealFolder}
                onCreateFile={createFile}
                onRemoveFile={removeFile}
              />
            </div>

            {tabs.open.map((path) =>
              mediaKindOf(path) ? (
                <MediaTab
                  key={path}
                  projectId={projectId}
                  path={path}
                  visible={tabs.active === path}
                />
              ) : (
                <Suspense
                  key={path}
                  fallback={
                    <div className="grid min-h-0 flex-1 place-items-center font-mono text-(length:--text-xs) text-dim">
                      Opening file…
                    </div>
                  }
                >
                  <FileTab
                    projectId={projectId}
                    path={path}
                    visible={tabs.active === path}
                    onDirtyChange={onDirtyChange}
                  />
                </Suspense>
              ),
            )}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
