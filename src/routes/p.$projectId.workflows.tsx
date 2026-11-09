import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { MotionItem, MotionPane } from "@/components/ade/motion";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { WorkflowBrowseCard } from "@/components/ade/workflows/WorkflowBrowseCard";
import { WorkflowDetailsPane } from "@/components/ade/workflows/WorkflowDetailsPane";
import {
  filterWorkflows,
  groupWorkflows,
  type WorkflowFilter,
} from "@/components/ade/workflows/workflowFilters.mjs";
import { workflowsQuery } from "@/lib/ade/queries";
import { askConfirm } from "@/lib/ade/userNotices";
import { deleteWorkflow } from "@/lib/ade/store";
import type { Workflow } from "@/lib/ade/types";

const NO_WORKFLOWS: Workflow[] = [];

const WorkflowEditor = lazy(() =>
  import("@/components/ade/workflows/WorkflowEditor").then((module) => ({
    default: module.WorkflowEditor,
  })),
);

type WorkflowsSearch = {
  new?: boolean;
};

const FILTERS: { id: WorkflowFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "builtin", label: "Built-in" },
  { id: "yours", label: "Yours" },
];

export const Route = createFileRoute("/p/$projectId/workflows")({
  head: () => ({ meta: [{ title: "Workflows — ADE" }] }),
  validateSearch: (search: Record<string, unknown>): WorkflowsSearch => {
    const raw = search["new"];
    const isNew = raw === true || raw === "true" || raw === "1" || raw === 1 ? true : undefined;
    return isNew ? { new: true } : {};
  },
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflowsResult = useQuery(workflowsQuery());
  const workflows = workflowsResult.data ?? NO_WORKFLOWS;
  const loading = workflowsResult.isPending;
  const [actionError, setActionError] = useState<string | null>(null);
  const error =
    actionError ??
    (workflowsResult.error
      ? workflowsResult.error instanceof Error
        ? workflowsResult.error.message
        : String(workflowsResult.error)
      : null);
  const [editor, setEditor] = useState<Workflow | "new" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setActionError(null);
    await queryClient.invalidateQueries({ queryKey: workflowsQuery().queryKey });
  }, [queryClient]);

  useEffect(() => {
    if (search.new) {
      setEditor("new");
      setSelectedId(null);
      void navigate({
        to: "/p/$projectId/workflows",
        params: { projectId },
        search: {},
        replace: true,
      });
    }
  }, [search.new, navigate, projectId]);

  const filtered = useMemo(
    () => filterWorkflows(workflows, filter, query) as Workflow[],
    [workflows, filter, query],
  );
  const grouped = useMemo(
    () =>
      groupWorkflows(filtered) as {
        builtIn: Workflow[];
        yours: Workflow[];
      },
    [filtered],
  );

  const selected = useMemo(
    () => (selectedId ? (workflows.find((w) => w.id === selectedId) ?? null) : null),
    [workflows, selectedId],
  );

  const closeEditor = () => setEditor(null);

  const onDelete = async (workflow: Workflow) => {
    if (workflow.builtIn) return;
    if (
      !(await askConfirm({
        title: `Delete workflow “${workflow.name}”?`,
        description: "This cannot be undone.",
        confirmLabel: "Delete",
      }))
    )
      return;
    try {
      await deleteWorkflow(workflow.id);
      if (editor !== "new" && editor?.id === workflow.id) setEditor(null);
      if (selectedId === workflow.id) setSelectedId(null);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const showPane = editor !== null || selected !== null;
  const emptyResults = !loading && filtered.length === 0;

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden @container/workflows">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 @lg/workflows:px-7 @lg/workflows:py-8">
          <h1 className="heading-display text-2xl @lg/workflows:text-3xl">Workflows</h1>
          <p className="mt-3 text-[13px] text-dim">
            Reusable prompts that attach to the start screen composer as a token. They never
            auto-send.
          </p>

          {error ? (
            <p className="mt-6 rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p>
          ) : null}

          <div className="mt-6 flex">
            <SegmentedControl
              label="Workflow filters"
              value={filter}
              onValueChange={(next) => setFilter(next as WorkflowFilter)}
              options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
            />
          </div>

          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search workflows"
              className="w-full rounded-md border border-line bg-paper py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
            />
          </div>

          <div className="mt-8 space-y-8">
            {loading ? (
              <TextShimmer as="p" className="text-[13px] text-dim">
                Loading workflows…
              </TextShimmer>
            ) : null}

            {emptyResults ? (
              <p className="text-[13px] text-dim">
                {workflows.length === 0 ? "No workflows yet." : "No workflows match this filter."}
              </p>
            ) : null}

            {grouped.builtIn.length > 0 ? (
              <section>
                <h2 className="label-mono">Built-in</h2>
                <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  <AnimatePresence initial={false} mode="popLayout">
                    {grouped.builtIn.map((workflow) => (
                      <MotionItem key={workflow.id} className="grid">
                        <WorkflowBrowseCard
                          workflow={workflow}
                          selected={selectedId === workflow.id && editor === null}
                          projectId={projectId}
                          onSelect={(w) => {
                            setEditor(null);
                            setSelectedId(w.id);
                          }}
                        />
                      </MotionItem>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            ) : null}

            {grouped.yours.length > 0 ? (
              <section>
                <h2 className="label-mono">Yours</h2>
                <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  <AnimatePresence initial={false} mode="popLayout">
                    {grouped.yours.map((workflow) => (
                      <MotionItem key={workflow.id} className="grid">
                        <WorkflowBrowseCard
                          workflow={workflow}
                          selected={selectedId === workflow.id && editor === null}
                          projectId={projectId}
                          onSelect={(w) => {
                            setEditor(null);
                            setSelectedId(w.id);
                          }}
                        />
                      </MotionItem>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            ) : null}
          </div>

          <div className="mt-10 pb-4">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setEditor("new");
              }}
              className="btn-amber px-4 py-2 text-[13px]"
            >
              + New workflow
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showPane ? (
          <MotionPane
            key="workflow-pane"
            className="absolute inset-y-0 right-0 z-10 w-full max-w-md shadow-xl flex h-full min-h-0 shrink-0 flex-col border-l border-line bg-panel @3xl/workflows:static @3xl/workflows:z-auto @3xl/workflows:w-[min(28rem,45%)] @3xl/workflows:max-w-none @3xl/workflows:shadow-none"
          >
            {editor !== null ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <Suspense
                  fallback={
                    <div className="grid place-items-center py-10 font-mono text-[12px] text-dim">
                      Loading editor…
                    </div>
                  }
                >
                  <WorkflowEditor
                    key={
                      editor === "new"
                        ? "new"
                        : editor.id
                          ? `edit-${editor.id}`
                          : `draft-${editor.name}`
                    }
                    initial={editor === "new" ? null : editor}
                    onSaved={async (saved) => {
                      closeEditor();
                      setSelectedId(saved.id);
                      await refresh();
                    }}
                    onCancel={closeEditor}
                  />
                </Suspense>
              </div>
            ) : selected ? (
              <WorkflowDetailsPane
                workflow={selected}
                projectId={projectId}
                onClose={() => setSelectedId(null)}
                onEdit={(w) => setEditor(w)}
                onDelete={(w) => void onDelete(w)}
              />
            ) : null}
          </MotionPane>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
