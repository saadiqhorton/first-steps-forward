import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Terminal } from "lucide-react";
import { AdeRow } from "@/components/ade/processes/AdeRow";
import { processesQuery } from "@/lib/ade/queries";

/**
 * ADE's own processes, in every project. Agent servers stay in the right-pane
 * Processes tab; this page is the app itself and other ADE instances sharing the
 * ADE checkout, read-only.
 */
export const Route = createFileRoute("/p/$projectId/processes")({
  head: () => ({ meta: [{ title: "ADE processes — ADE" }] }),
  component: AdeProcessesPage,
});

function AdeProcessesPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const query = useQuery(processesQuery(projectId));
  const ade = query.data?.ade ?? null;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-5 py-10 @lg:px-8">
        <div className="w-full">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[12px] text-dim">ADE</div>
              <h1 className="mt-2 font-display text-2xl tracking-normal @lg:text-[28px]">
                ADE processes
              </h1>
              <p className="mt-3 max-w-[56ch] text-[13px] leading-relaxed text-dim">
                The app you are in, and any other ADE running the ADE checkout. This page is the
                same in every project; agent servers and watchers stay in the right-pane Processes
                tab, with their output and controls.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/p/$projectId/conversations",
                  params: { projectId },
                  search: { pane: "processes" },
                })
              }
              className="btn-quiet inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px]"
            >
              <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
              Agent processes
              <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <section
            aria-label="ADE processes"
            className="mt-8 overflow-hidden rounded-xl border border-line bg-panel"
          >
            <div className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 text-[12px] text-dim">
              <span className="font-medium">ADE on this machine</span>
              <span className="ml-auto font-mono text-[11px]">Read only</span>
            </div>
            <div className="p-1">
              {ade?.app ? <AdeRow name="ADE" note="This app" address={ade.app.address} /> : null}
              {ade?.unmanaged.map((item) => (
                <AdeRow
                  key={item.port}
                  name="ADE dev server"
                  note="Unmanaged"
                  address={item.address}
                />
              ))}
              {!ade ? (
                <p className="px-3 py-3 text-[12px] text-dim">
                  {query.isPending
                    ? "Reading ADE processes…"
                    : "ADE isn't reporting its processes."}
                </p>
              ) : !ade.unmanaged.length ? (
                <p className="px-3 py-3 font-mono text-[11px] leading-relaxed text-dim">
                  No other ADE servers are running the ADE checkout
                </p>
              ) : null}
            </div>
          </section>

          <p className="mt-3 max-w-[56ch] font-mono text-[11px] leading-relaxed text-dim">
            Open uses ADE's browser; use Open in external browser there for a separate window.
            Nothing here is stoppable from this page, and Stop all never touches these rows.
          </p>
        </div>
      </div>
    </main>
  );
}
