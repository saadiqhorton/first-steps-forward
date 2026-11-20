import { CircleAlert } from "lucide-react";
import { CustomizeRequestError, useCustomize } from "@/lib/ade/customizeApi";
import { useAdeState } from "@/lib/ade/store";
import { Breadcrumb } from "./ChangeHeader";

function Frame({
  status,
  dot = "bg-dim",
  children,
}: {
  status: string;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="shrink-0 border-b border-line px-4 pt-5 pb-4 @lg:px-7">
        <Breadcrumb />
        <p className="mt-3 flex items-center gap-2 text-xs text-dim">
          <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          {status}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @lg:px-7">{children}</div>
    </>
  );
}

/**
 * Loading and unavailable states shared by the start screen and a change. Renders
 * `children(state)` once the local service has answered with a usable state.
 */
export function CustomizeGate({
  children,
}: {
  children: (state: NonNullable<ReturnType<typeof useCustomize>["data"]>) => React.ReactNode;
}) {
  const query = useCustomize();
  const { hydrated, serviceAvailable } = useAdeState((s) => ({
    hydrated: s.hydrated,
    serviceAvailable: s.serviceAvailable,
  }));

  if (hydrated && !serviceAvailable)
    return (
      <Frame status="Local service disconnected">
        <p className="text-ui text-dim">
          ADE's local service is not answering. Customize ADE needs it.
        </p>
      </Frame>
    );
  if (query.isPending)
    return (
      <Frame status="Loading">
        <p className="text-ui text-dim">Loading your changes…</p>
      </Frame>
    );
  if (query.isError) {
    const missing = query.error instanceof CustomizeRequestError && query.error.missing;
    return (
      <Frame status="Not available">
        <div className="card-panel flex max-w-3xl items-start gap-3 p-5" role="alert">
          <CircleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-deep"
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-ui font-medium text-ink">
              {missing ? "This ADE can't customize itself yet" : "Customize ADE could not load"}
            </p>
            <p className="mt-1 text-ui leading-5 text-[color:var(--text-secondary)]">
              {missing
                ? "The local service running now has no customization support. Update ADE and start it again."
                : query.error.message}
            </p>
            {!missing && (
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="btn-quiet mt-3 px-3 py-1.5 text-xs"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </Frame>
    );
  }
  const state = query.data;
  if (!state.available)
    return (
      <Frame status="Not available">
        <div className="card-panel flex max-w-3xl items-start gap-3 p-5" role="alert">
          <CircleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-deep"
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-ui font-medium text-ink">Customization isn't available here</p>
            <p className="mt-1 text-ui leading-5 text-[color:var(--text-secondary)]">
              {state.unavailableReason ?? "ADE could not find its own source to copy."}
            </p>
          </div>
        </div>
      </Frame>
    );
  return <>{children(state)}</>;
}

export { Frame as CustomizeFrame };
