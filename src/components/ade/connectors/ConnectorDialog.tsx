import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  addConnector,
  CONNECTORS_QUERY_KEY,
  updateConnector,
  type AddCustomInput,
  type Connector,
  type ConnectorPatch,
  type ConnectorPreset,
  type ConnectorTransport,
} from "@/lib/ade/connectorsApi";
import {
  DEFAULT_SCOPE,
  deriveServerName,
  joinCommand,
  PRESET_LOGOS,
  SCOPE_ERROR,
  scopeFromConnector,
  scopeInvalid,
  scopeToRequest,
  SEGMENTS,
  splitCommand,
  type ScopeValue,
} from "./connectorText";
import { ScopePicker } from "./ScopePicker";

export type ConnectorDialogTarget =
  | { kind: "preset"; preset: ConnectorPreset }
  | { kind: "custom" }
  | { kind: "edit"; connector: Connector; preset?: ConnectorPreset | undefined };

const FIELD =
  "h-10.5 w-full min-w-0 rounded-md border border-line bg-panel px-3 text-ink placeholder:text-dim/70 read-only:text-dim";
const INPUT = `${FIELD} text-ui`;
const MONO_INPUT = `${FIELD} font-mono text-(length:--text-xs)`;

const TYPES = [
  { value: "http", label: "Remote URL" },
  { value: "stdio", label: "Local command" },
];

/** A saved header or env var keeps its value on the server; the form only ever holds new text. */
type SecretRow = { key: string; name: string; value: string; saved: boolean; removed: boolean };

let rowKey = 0;
const nextKey = () => `row-${++rowKey}`;
const emptyRow = (): SecretRow => ({
  key: nextKey(),
  name: "",
  value: "",
  saved: false,
  removed: false,
});
const savedRows = (refs: { name: string; set: boolean }[] | undefined) =>
  (refs ?? []).map((ref) => ({
    key: nextKey(),
    name: ref.name,
    value: "",
    saved: ref.set,
    removed: false,
  }));

/** New values by name; on edit, saved rows send "" to keep or null to remove. */
function secretPayload(rows: SecretRow[], editing: boolean) {
  const out: Record<string, string | null> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    if (row.saved || (editing && row.removed)) {
      if (row.removed) out[name] = null;
      else out[name] = row.value;
    } else if (!row.removed && row.value) out[name] = row.value;
  }
  return out;
}

export function ConnectorDialog({
  target,
  projects,
  onClose,
}: {
  target: ConnectorDialogTarget | null;
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="block max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-y-auto border-line bg-paper p-0 sm:rounded-md">
        {target && <ConnectorForm target={target} projects={projects} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ConnectorForm({
  target,
  projects,
  onClose,
}: {
  target: ConnectorDialogTarget;
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const editing = target.kind === "edit" ? target.connector : null;
  const preset =
    target.kind === "preset" ? target.preset : target.kind === "edit" ? target.preset : undefined;
  const isPreset = target.kind === "preset" || !!editing?.preset;
  const presetLabel = preset?.label ?? editing?.label ?? "";

  const [scope, setScope] = useState<ScopeValue>(
    editing ? scopeFromConnector(editing) : DEFAULT_SCOPE,
  );
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [label, setLabel] = useState(editing?.label ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [transport, setTransport] = useState<ConnectorTransport>(editing?.transport ?? "http");
  const [url, setUrl] = useState(
    editing?.url ?? (target.kind === "preset" ? target.preset.url : ""),
  );
  const [commandLine, setCommandLine] = useState(
    editing?.transport === "stdio" ? joinCommand(editing.command ?? "", editing.args ?? []) : "",
  );
  const [headers, setHeaders] = useState<SecretRow[]>(() => [
    ...savedRows(editing?.headers),
    emptyRow(),
  ]);
  const [env, setEnv] = useState<SecretRow[]>(() => [...savedRows(editing?.env), emptyRow()]);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const scopeFields = scopeToRequest(scope);
      if (!scopeFields) throw new Error(SCOPE_ERROR);
      if (isPreset) {
        if (!url.trim()) throw new Error("Enter the server's URL.");
        if (editing) {
          const patch: ConnectorPatch = { ...scopeFields, url: url.trim() };
          if (apiKey.trim()) patch.apiKey = apiKey.trim();
          else if (removeKey) patch.apiKey = null;
          return updateConnector(editing.id, patch);
        }
        return addConnector({
          preset: preset!.id,
          ...(url.trim() && url.trim() !== preset!.url ? { url: url.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...scopeFields,
        });
      }
      if (!label.trim()) throw new Error("Give the connector a name.");
      const fields: Partial<AddCustomInput> = { label: label.trim() };
      if (transport === "http") {
        if (!url.trim()) throw new Error("Enter the server's URL.");
        fields.url = url.trim();
      } else {
        const { command, args } = splitCommand(commandLine);
        if (!command) throw new Error("Enter the command that starts the server.");
        fields.command = command;
        fields.args = args;
      }
      const secrets = secretPayload(transport === "http" ? headers : env, !!editing);
      if (editing) {
        const patch: ConnectorPatch = { ...fields, ...scopeFields };
        if (transport === "http") patch.headers = secrets;
        else patch.env = secrets;
        return updateConnector(editing.id, patch);
      }
      const created = secrets as Record<string, string>;
      return addConnector({
        ...fields,
        label: label.trim(),
        transport,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(transport === "http" ? { headers: created } : { env: created }),
        ...scopeFields,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY });
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Could not save this connector."),
  });

  const title =
    target.kind === "preset"
      ? `Add ${target.preset.label}`
      : target.kind === "custom"
        ? "Custom connector"
        : `Edit ${target.connector.label}`;
  const description =
    isPreset && preset
      ? `${preset.description.replace(/\.$/, "")}, from ${preset.url}.`
      : "Any MCP server: a remote URL, or a command ADE starts on this machine for each turn.";
  const logo = isPreset ? PRESET_LOGOS[(preset?.id ?? editing?.preset)!] : null;
  const keySaved = !!editing?.keySet && !removeKey;

  return (
    <form
      className="p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        // The scope picker already shows why it can't be saved.
        if (scopeInvalid(scope)) return;
        save.mutate();
      }}
    >
      <div className="flex items-center gap-3 pr-6">
        {logo && (
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-panel">
            <img src={logo} alt="" className="size-5 object-contain" />
          </span>
        )}
        <DialogTitle className="text-xl font-medium leading-snug">{title}</DialogTitle>
      </div>
      <DialogDescription className="mt-2 text-ui! leading-normal text-dim">
        {description}
      </DialogDescription>

      <div className="mt-5 grid gap-5">
        {isPreset ? (
          <>
            <Field label="Remote URL" help="ADE connects to it over Streamable HTTP.">
              <input
                className={MONO_INPUT}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                inputMode="url"
                spellCheck={false}
                required
                autoFocus={target.kind === "edit"}
              />
            </Field>
            <Field
              label="API key"
              help={
                <>
                  {keySaved
                    ? "Type a new key to replace the saved one. "
                    : `Without a key ${presetLabel} runs at its free rate limit. `}
                  {keySaved ? (
                    <button
                      type="button"
                      className="text-teal-deep underline underline-offset-2"
                      onClick={() => {
                        setRemoveKey(true);
                        setApiKey("");
                      }}
                    >
                      Remove key
                    </button>
                  ) : (
                    preset && (
                      <a
                        href={preset.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-teal-deep underline underline-offset-2"
                      >
                        Get a key
                        <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
                      </a>
                    )
                  )}
                </>
              }
            >
              <SecretInput
                value={apiKey}
                onChange={setApiKey}
                saved={keySaved}
                placeholder="Optional"
                label="API key"
              />
            </Field>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Name">
                <input
                  className={INPUT}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Playwright"
                  maxLength={60}
                  autoFocus
                />
              </Field>
              <Field label="Server name agents see">
                <input
                  className={MONO_INPUT}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={deriveServerName(label) || "server_name"}
                  readOnly={!!editing}
                  title={
                    editing ? "The server name is set when the connector is added." : undefined
                  }
                  spellCheck={false}
                  maxLength={40}
                />
              </Field>
            </div>
            {!editing && (
              <div className="grid gap-2">
                <div className="label-mono">Type</div>
                <SegmentedControl
                  label="Type"
                  value={transport}
                  onValueChange={(next) => setTransport(next as ConnectorTransport)}
                  options={TYPES}
                  className={SEGMENTS}
                />
              </div>
            )}
            {transport === "http" ? (
              <>
                <Field label="URL" help="ADE connects to it over Streamable HTTP.">
                  <input
                    className={MONO_INPUT}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                    inputMode="url"
                    spellCheck={false}
                  />
                </Field>
                <SecretRows
                  title="Headers"
                  namePlaceholder="Header"
                  rows={headers}
                  onChange={setHeaders}
                />
              </>
            ) : (
              <>
                <Field
                  label="Command"
                  help="Runs in the project folder. Arguments go to the program as-is, never through a shell."
                >
                  <input
                    className={MONO_INPUT}
                    value={commandLine}
                    onChange={(event) => setCommandLine(event.target.value)}
                    placeholder="npx @playwright/mcp@latest --headless"
                    spellCheck={false}
                  />
                </Field>
                <SecretRows
                  title="Environment variables"
                  namePlaceholder="NAME"
                  rows={env}
                  onChange={setEnv}
                />
              </>
            )}
          </>
        )}
        <ScopePicker value={scope} onChange={setScope} projects={projects} />
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <button type="submit" disabled={save.isPending} className="btn-amber px-3 py-2 text-ui">
          {save.isPending
            ? "Saving…"
            : target.kind === "preset"
              ? "Add connector"
              : "Save connector"}
        </button>
        <button type="button" onClick={onClose} className="btn-quiet px-3 py-2 text-ui">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label className="grid min-w-0 gap-2">
        <span className="label-mono">{label}</span>
        {children}
      </label>
      {help && <p className="text-xs leading-normal text-(--text-secondary)">{help}</p>}
    </div>
  );
}

/** A secret never comes back from the service; a saved one shows "Saved" until replaced. */
function SecretInput({
  value,
  onChange,
  saved,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  saved: boolean;
  placeholder: string;
  label: string;
}) {
  return (
    <span className="relative block min-w-0">
      <input
        type="password"
        className={INPUT}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={saved ? "" : placeholder}
        aria-label={label}
        autoComplete="new-password"
        spellCheck={false}
      />
      {saved && !value && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-1 text-xs text-teal-deep">
          <Check className="size-3" strokeWidth={1.5} aria-hidden />
          Saved
        </span>
      )}
    </span>
  );
}

function SecretRows({
  title,
  namePlaceholder,
  rows,
  onChange,
}: {
  title: string;
  namePlaceholder: string;
  rows: SecretRow[];
  onChange: (rows: SecretRow[]) => void;
}) {
  const update = (key: string, patch: Partial<SecretRow>) => {
    const next = rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
    const last = next.filter((row) => !row.removed).at(-1);
    onChange(last && !last.saved && (last.name || last.value) ? [...next, emptyRow()] : next);
  };
  const remove = (row: SecretRow) => {
    const next = row.saved
      ? rows.map((item) => (item.key === row.key ? { ...item, removed: true, value: "" } : item))
      : rows.filter((item) => item.key !== row.key);
    const visible = next.filter((item) => !item.removed);
    const last = visible.at(-1);
    onChange(!last || last.saved || last.name || last.value ? [...next, emptyRow()] : next);
  };
  const noun = title === "Headers" ? "header" : "variable";
  return (
    <div className="grid gap-2">
      <div className="label-mono">{title}</div>
      {rows
        .filter((row) => !row.removed)
        .map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
          >
            <input
              className={MONO_INPUT}
              value={row.name}
              onChange={(event) => update(row.key, { name: event.target.value })}
              placeholder={namePlaceholder}
              aria-label={`${noun} name`}
              readOnly={row.saved}
              spellCheck={false}
            />
            <SecretInput
              value={row.value}
              onChange={(value) => update(row.key, { value })}
              saved={row.saved}
              placeholder="Value, kept secret"
              label={`${row.name || noun} value`}
            />
            <button
              type="button"
              onClick={() => remove(row)}
              aria-label={`Remove ${noun}`}
              className="grid size-7 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        ))}
    </div>
  );
}
