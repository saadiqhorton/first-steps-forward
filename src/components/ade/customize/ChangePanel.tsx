import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Eye,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
} from "lucide-react";
import { GlideIndicator } from "@/components/ade/motion";
import { previewRunning, type Change, type CustomizeState } from "@/lib/ade/customizeApi";
import { ChecksPanel } from "./ChecksPanel";
import { FilesPanel } from "./FilesPanel";
import { KeptList } from "./KeptList";
import { PreviewPanel } from "./PreviewPanel";
import { StockHint } from "./StockHint";

export type PanelTab = "preview" | "checks" | "changes";

const COLLAPSED_KEY = "ade-customize-panel-collapsed";

const TABS: { id: PanelTab; label: string; Icon: typeof Eye }[] = [
  { id: "preview", label: "Preview", Icon: Eye },
  { id: "checks", label: "Checks", Icon: ShieldCheck },
  { id: "changes", label: "Changes", Icon: FileText },
];

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Private mode: the panel still toggles for this visit.
  }
}

function defaultTab(change: Change): PanelTab {
  if (change.status === "kept" || change.status === "removed") return "changes";
  return change.preview.status === "stopped" ? "checks" : "preview";
}

/**
 * The panel's tab, owned by the change view so Try it can bring Preview forward. A failed check
 * moves it to Checks once, so the failure is never off screen; each change starts on its default.
 */
export function usePanelTab(change: Change) {
  const [tab, setTab] = useState<PanelTab>(() => defaultTab(change));
  const failed = change.checks.some((c) => c.status === "failed");
  useEffect(() => {
    if (failed) setTab("checks");
  }, [failed]);
  // Kept: the preview is gone, so show what went into your ADE.
  const kept = change.status === "kept";
  useEffect(() => {
    if (kept) setTab("changes");
  }, [kept]);
  useEffect(() => setTab(defaultTab(change)), [change.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per change only
  return [tab, setTab] as const;
}

function previewTone(change: Change) {
  if (change.preview.status === "running") return "bg-teal";
  if (change.preview.status === "starting") return "bg-teal animate-pulse-soft";
  if (change.preview.status === "failed") return "bg-danger";
  return null;
}

function checkTone(change: Change) {
  if (change.checks.some((c) => c.status === "failed")) return "bg-danger";
  if (change.checks.some((c) => c.status === "running")) return "bg-teal animate-pulse-soft";
  if (
    change.checks.length &&
    change.checks.every((c) => c.status === "passed" || c.status === "skipped")
  )
    return "bg-teal";
  return null;
}

/** Route-owned right panel: Preview / Checks / Changes, collapsible to an icon rail. */
export function ChangePanel({
  change,
  state,
  phoneActive,
  tab,
  onTabChange: setTab,
  reveal,
  expanded,
  onExpand,
}: {
  change: Change;
  state: CustomizeState;
  /** Phones show one pane at a time; this one when its tab is selected. */
  phoneActive: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** Bumped when something (Try it) needs the panel open. */
  reveal: number;
  /** The running preview covers the conversation column (phones: the whole screen). */
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => {
    if (reveal) setCollapsed(false);
  }, [reveal]);

  const toggle = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };
  const dots: Partial<Record<PanelTab, string | null>> = {
    preview: previewTone(change),
    checks: checkTone(change),
  };

  const phone = phoneActive ? "flex" : "hidden";
  const showingPreview = tab === "preview" && previewRunning(change);

  if (expanded) return panel("flex", true);

  if (collapsed)
    return (
      <>
        {panel(`${phone} lg:hidden`)}
        <aside
          aria-label="Change details"
          className="hidden w-12 shrink-0 flex-col items-center gap-1 border-l border-line bg-panel py-2 lg:flex"
        >
          <button
            type="button"
            onClick={() => toggle(false)}
            aria-label="Show details panel"
            title="Show details panel"
            className="grid size-7 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <PanelRightOpen className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
          <div className="h-px w-5 bg-line" />
          {TABS.map(({ id, label, Icon }) => (
            <div key={id} className="relative">
              <button
                type="button"
                aria-label={label}
                title={label}
                onClick={() => {
                  setTab(id);
                  toggle(false);
                }}
                className={`grid size-7 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-amber ${
                  tab === id
                    ? "bg-ink/[0.06] text-ink"
                    : "text-dim hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <Icon className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
              {dots[id] && (
                <span
                  className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ${dots[id]}`}
                  aria-hidden
                />
              )}
            </div>
          ))}
        </aside>
      </>
    );

  return panel(`${phone} lg:flex`);

  function panel(display: string, big = false) {
    // A running preview gets room: wider beside the conversation, or over it when expanded.
    const size = big
      ? "fixed inset-0 z-[var(--z-dropdown)] lg:static lg:z-auto lg:flex-1 lg:border-l"
      : showingPreview
        ? "lg:w-[45%] lg:border-l"
        : "lg:w-96 lg:border-l";
    return (
      <aside
        aria-label={big ? "Preview" : "Change details"}
        className={`min-h-0 w-full shrink-0 flex-col border-line bg-panel ${size} ${display}`}
      >
        {big ? (
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 lg:h-9 lg:px-2">
            <button
              type="button"
              onClick={() => onExpand(false)}
              title="Back to the change (Esc)"
              className="btn-quiet inline-flex min-h-[var(--control-height-md)] shrink-0 items-center gap-1.5 px-3 text-xs lg:min-h-0 lg:py-1"
            >
              <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
              Back to the change
            </button>
            <p className="min-w-0 truncate text-xs text-dim">
              Trying <span className="text-ink">{change.title}</span>
            </p>
          </div>
        ) : (
          <div
            role="tablist"
            aria-label="Change details"
            className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-2"
          >
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-amber ${active ? "text-ink" : "text-dim hover:text-ink"}`}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                  {label}
                  {dots[id] && (
                    <span className={`size-1.5 shrink-0 rounded-full ${dots[id]}`} aria-hidden />
                  )}
                  {active && (
                    <GlideIndicator
                      id="customize-panel-tab"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink"
                    />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => toggle(true)}
              aria-label="Hide details panel"
              title="Hide details panel"
              className="ml-auto hidden size-7 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber lg:grid"
            >
              <PanelRightClose className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        )}

        <div
          role="tabpanel"
          className={`min-h-0 flex-1 overflow-y-auto ${showingPreview ? "flex flex-col gap-5 px-3 py-3" : "space-y-5 px-4 py-4"}`}
        >
          {tab === "preview" && <PreviewPanel change={change} expanded={big} onExpand={onExpand} />}
          {tab === "checks" && <ChecksPanel key={change.id} change={change} />}
          {tab === "changes" && (
            <>
              <FilesPanel files={change.files} working={change.status === "working"} />
              {change.status === "kept" && (
                <KeptList state={state} showSwitch={false} currentId={change.id} />
              )}
            </>
          )}
          {!(tab === "changes" && change.status === "kept") && !showingPreview && <StockHint />}
        </div>
      </aside>
    );
  }
}
