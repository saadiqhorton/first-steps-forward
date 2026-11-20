import { useEffect, useState } from "react";
import { Eye, FileText, PanelRightClose, PanelRightOpen, ShieldCheck } from "lucide-react";
import { GlideIndicator } from "@/components/ade/motion";
import type { Change, CustomizeState } from "@/lib/ade/customizeApi";
import { ChecksPanel } from "./ChecksPanel";
import { PREVIEW_LATER } from "./customizeText";
import { FilesPanel } from "./FilesPanel";
import { KeptList } from "./KeptList";
import { StockHint } from "./StockHint";

type PanelTab = "preview" | "checks" | "changes";

const COLLAPSED_KEY = "ade-customize-panel-collapsed";

// Preview lands in round 2; until then only dev builds show the tab, with an honest note.
const TABS: { id: PanelTab; label: string; Icon: typeof Eye }[] = [
  ...(import.meta.env.DEV ? [{ id: "preview" as const, label: "Preview", Icon: Eye }] : []),
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
  return change.status === "kept" || change.status === "removed" ? "changes" : "checks";
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
}: {
  change: Change;
  state: CustomizeState;
  /** Phones show one pane at a time; this one when its tab is selected. */
  phoneActive: boolean;
}) {
  const [tab, setTab] = useState<PanelTab>(() => defaultTab(change));
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);
  // A failed check moves the panel to it once, so the failure is never off screen.
  const failed = change.checks.some((c) => c.status === "failed");
  useEffect(() => {
    if (failed) setTab("checks");
  }, [failed]);
  useEffect(() => setTab(defaultTab(change)), [change.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per change only

  const toggle = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };
  const dot = checkTone(change);

  const phone = phoneActive ? "flex" : "hidden";

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
              {id === "checks" && dot && (
                <span
                  className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ${dot}`}
                  aria-hidden
                />
              )}
            </div>
          ))}
        </aside>
      </>
    );

  return panel(`${phone} lg:flex`);

  function panel(display: string) {
    return (
      <aside
        aria-label="Change details"
        className={`min-h-0 w-full shrink-0 flex-col border-line bg-panel lg:w-96 lg:border-l ${display}`}
      >
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
                {id === "checks" && dot && (
                  <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
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

        <div role="tabpanel" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {tab === "preview" && (
            <div className="rounded-md border border-dashed border-line px-4 py-6 text-center">
              <Eye className="mx-auto size-4 text-dim" strokeWidth={1.5} aria-hidden />
              <p className="mt-2 text-ui text-ink">{PREVIEW_LATER}</p>
              <p className="mt-1 text-xs leading-5 text-dim">
                Until then, the checks are what tell you a change is safe to keep.
              </p>
            </div>
          )}
          {tab === "checks" && <ChecksPanel key={change.id} change={change} />}
          {tab === "changes" && (
            <>
              <FilesPanel files={change.files} working={change.status === "working"} />
              {change.status === "kept" && <KeptList state={state} />}
            </>
          )}
          {!(tab === "changes" && change.status === "kept") && <StockHint />}
        </div>
      </aside>
    );
  }
}
