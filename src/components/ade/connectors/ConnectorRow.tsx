import { Globe, Pencil, SquareTerminal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Connector } from "@/lib/ade/connectorsApi";
import { keySummary, PRESET_LOGOS, scopeSummary, targetLine } from "./connectorText";

export type TestState =
  | { status: "pending" }
  | { status: "ok"; text: string; tools: string[] }
  | { status: "error"; text: string }
  | { status: "info"; text: string };

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink";

/** The 28px mark tile used by rows and preset cards. */
export function ConnectorLogo({
  connector,
}: {
  connector: Pick<Connector, "preset" | "transport">;
}) {
  const Icon = connector.transport === "stdio" ? SquareTerminal : Globe;
  return (
    <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-paper">
      {connector.preset ? (
        <img src={PRESET_LOGOS[connector.preset]} alt="" className="size-4.5 object-contain" />
      ) : (
        <Icon className="size-4 text-dim" strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

export function ConnectorRow({
  connector,
  projectNames,
  test,
  onTest,
  onToggle,
  onEdit,
  onRemove,
}: {
  connector: Connector;
  projectNames: Map<string, string>;
  test?: TestState | undefined;
  onTest: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const off = !connector.enabled;
  const dim = off ? "opacity-(--opacity-disabled)" : "";
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" data-connector={connector.name}>
      <span className={`mt-0.5 self-start ${dim}`}>
        <ConnectorLogo connector={connector} />
      </span>
      <div className={`grid min-w-0 flex-1 basis-48 gap-0.5 ${dim}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ui font-medium leading-normal">{connector.label}</span>
          <span className="shrink-0 rounded-full border border-line px-2 font-mono text-2xs leading-normal text-dim">
            {connector.name}
          </span>
        </div>
        <div className="truncate font-mono text-caption leading-tight text-dim">
          {targetLine(connector)}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-normal text-(--text-secondary)">
          <span>{scopeSummary(connector, projectNames)}</span>
          <span className="text-dim" aria-hidden>
            ·
          </span>
          <span>{keySummary(connector)}</span>
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3 pl-10 @2xl:w-auto @2xl:shrink-0 @2xl:flex-nowrap @2xl:pl-0">
        <TestResult test={test} />
        <button
          type="button"
          onClick={() => {
            setToolsOpen(false);
            onTest();
          }}
          disabled={test?.status === "pending"}
          className="btn-quiet h-7 shrink-0 px-3 text-xs"
          aria-label={`Test ${connector.label}`}
        >
          Test
        </button>
        {test?.status === "ok" && (
          <button
            type="button"
            onClick={() => setToolsOpen((open) => !open)}
            className="btn-quiet h-7 shrink-0 px-3 text-xs"
            aria-expanded={toolsOpen}
            aria-controls={`connector-tools-${connector.id}`}
          >
            {toolsOpen ? "Hide tools" : "Preview tools"}
          </button>
        )}
        <label className="inline-flex w-11 shrink-0 cursor-pointer items-center gap-1.5 text-xs text-(--text-secondary)">
          <input
            type="checkbox"
            checked={connector.enabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="size-4 shrink-0 accent-amber"
            aria-label={`${connector.label} enabled`}
          />
          {connector.enabled ? "On" : "Off"}
        </label>
        <button
          type="button"
          onClick={onEdit}
          className={ICON_BUTTON}
          aria-label={`Edit ${connector.label}`}
        >
          <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={ICON_BUTTON}
          aria-label={`Remove ${connector.label}`}
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {test?.status === "ok" && toolsOpen && (
        <div
          id={`connector-tools-${connector.id}`}
          className="ml-10 grid basis-full gap-2 rounded-md border border-line bg-panel p-3"
        >
          <div className="label-mono">Available tools</div>
          {test.tools.length ? (
            <ul className="flex flex-wrap gap-2" aria-label={`${connector.label} available tools`}>
              {test.tools.map((tool) => (
                <li
                  key={tool}
                  className="rounded-sm border border-line bg-paper px-2 py-1 font-mono text-2xs leading-normal text-(--text-secondary)"
                >
                  {tool}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-normal text-dim">
              This server did not advertise any tools.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TestResult({ test }: { test?: TestState | undefined }) {
  if (!test) return null;
  if (test.status === "pending") return <span className="text-xs text-dim">Testing…</span>;
  const tone =
    test.status === "ok" ? "text-teal-deep" : test.status === "error" ? "text-danger" : "text-dim";
  return (
    <span
      role="status"
      title={test.text}
      className={`inline-flex w-full min-w-0 items-center gap-1.5 text-xs @2xl:w-auto @2xl:max-w-60 ${tone}`}
    >
      {test.status !== "info" && (
        <span
          className={`size-1.5 shrink-0 rounded-full ${test.status === "ok" ? "bg-teal" : "bg-danger"}`}
          aria-hidden
        />
      )}
      <span className="truncate">{test.text}</span>
    </span>
  );
}
