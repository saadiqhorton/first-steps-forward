import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import {
  CONNECTORS_QUERY_KEY,
  getConnectors,
  removeConnector,
  testConnector,
  updateConnector,
  type Connector,
  type ConnectorPreset,
} from "@/lib/ade/connectorsApi";
import { useAdeState } from "@/lib/ade/store";
import { askConfirm, warnUser } from "@/lib/ade/userNotices";
import { ConnectorDialog, type ConnectorDialogTarget } from "./ConnectorDialog";
import { ConnectorLogo, ConnectorRow, type TestState } from "./ConnectorRow";

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** MCP servers the user adds once and hands to Luna, their projects, or both. */
export function ConnectorsWorkspace() {
  const client = useQueryClient();
  const projects = useAdeState((state) => state.projects);
  const { data, error, isPending } = useQuery({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: getConnectors,
  });
  const connectors = data?.connectors ?? [];
  const presets = data?.presets ?? [];
  const [dialog, setDialog] = useState<ConnectorDialogTarget | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );
  const refresh = () => client.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateConnector(id, { enabled }),
    onSettled: refresh,
    onError: (cause) => void warnUser(message(cause, "Could not change this connector.")),
  });

  const runTest = async (connector: Connector) => {
    setTests((current) => ({ ...current, [connector.id]: { status: "pending" } }));
    let next: TestState;
    try {
      const result = await testConnector(connector.id);
      next = result.ok
        ? {
            status: "ok",
            text: `Connected · ${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"}`,
            tools: result.tools,
          }
        : { status: "error", text: result.error };
    } catch (cause) {
      // A local command can't be tested from here; the service says so in a 400.
      next =
        connector.transport === "stdio"
          ? { status: "info", text: message(cause, "Testing runs only for remote connectors.") }
          : { status: "error", text: message(cause, "The test could not run.") };
    }
    setTests((current) => ({ ...current, [connector.id]: next }));
  };

  const remove = async (connector: Connector) => {
    const confirmed = await askConfirm({
      title: `Remove ${connector.label}?`,
      description:
        "Agents stop seeing it from their next turn, and its saved keys are deleted from this machine.",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    try {
      await removeConnector(connector.id);
      setTests(({ [connector.id]: _removed, ...rest }) => rest);
    } catch (cause) {
      void warnUser(message(cause, "Could not remove this connector."));
    }
    await refresh();
  };

  const presetFor = (connector: Connector) =>
    connector.preset ? presets.find((preset) => preset.id === connector.preset) : undefined;

  return (
    <main className="workspace-page @container">
      <div className="max-w-4xl">
        <div className="flex items-center gap-2">
          <Link to="/workspace" className="label-mono hover:text-ink">
            Workspace
          </Link>
          <span className="label-mono">/ connectors</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-lg font-medium leading-snug">Connectors</h1>
            <p className="mt-1 text-ui leading-normal text-dim">
              MCP servers your agents can use. Choose whether Luna, your projects, or both get each
              one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialog({ kind: "custom" })}
            className="btn-quiet inline-flex h-7 shrink-0 items-center gap-1.5 px-3 text-xs"
          >
            <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
            Custom connector
          </button>
        </div>

        <div className="label-mono mb-2 mt-6">Your connectors</div>
        {error ? (
          <p role="alert" className="card-panel p-4 text-ui text-danger">
            {message(error, "Could not load connectors.")}
          </p>
        ) : isPending ? (
          <p className="card-panel p-4 text-ui text-dim">Loading connectors…</p>
        ) : connectors.length === 0 ? (
          <p className="card-panel p-4 text-ui text-dim">
            No connectors yet. Add one of the services below, or any MCP server as a custom
            connector.
          </p>
        ) : (
          <>
            <section className="card-panel divide-y divide-line overflow-hidden">
              {connectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  projectNames={projectNames}
                  test={tests[connector.id]}
                  onTest={() => void runTest(connector)}
                  onToggle={(enabled) => toggle.mutate({ id: connector.id, enabled })}
                  onEdit={() =>
                    setDialog({ kind: "edit", connector, preset: presetFor(connector) })
                  }
                  onRemove={() => void remove(connector)}
                />
              ))}
            </section>
            <p className="mt-2 text-caption leading-normal text-dim">
              Keys stay on this machine in ~/.ade and are never shown again.
            </p>
          </>
        )}

        {presets.length > 0 && (
          <>
            <div className="label-mono mb-2 mt-6">Add a connector</div>
            <div className="grid gap-3 @2xl:grid-cols-3">
              {presets.map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  added={connectors.some((connector) => connector.preset === preset.id)}
                  onAdd={() => setDialog({ kind: "preset", preset })}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <ConnectorDialog target={dialog} projects={projectOptions} onClose={() => setDialog(null)} />
    </main>
  );
}

function PresetCard({
  preset,
  added,
  onAdd,
}: {
  preset: ConnectorPreset;
  added: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="card-panel flex flex-col gap-3 p-4 @2xl:min-h-37" data-preset={preset.id}>
      <div className="flex items-center gap-2.5">
        <ConnectorLogo connector={{ preset: preset.id, transport: "http" }} />
        <span className="text-ui font-medium leading-normal">{preset.label}</span>
      </div>
      <p className="flex-1 text-xs leading-normal text-(--text-secondary)">{preset.description}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xs text-dim">Key optional</span>
        {added ? (
          <span className="inline-flex items-center gap-1 text-xs text-teal-deep">
            <Check className="size-3.5" strokeWidth={1.5} aria-hidden />
            Added
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="btn-quiet inline-flex h-7 items-center gap-1.5 px-3 text-xs"
            aria-label={`Add ${preset.label}`}
          >
            <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
            Add
          </button>
        )}
      </div>
    </div>
  );
}
