import type { Connector, ConnectorPresetId, ConnectorProjects } from "@/lib/ade/connectorsApi";

/** Vendor marks served from public/connectors. */
export const PRESET_LOGOS: Record<ConnectorPresetId, string> = {
  parallel: "/connectors/parallel.png",
  exa: "/connectors/exa.svg",
  firecrawl: "/connectors/firecrawl.svg",
};

// Arc's segmented control styles live in an unlayered CSS module, so these need `!` to win.
// They stretch the options evenly across a 20rem track like the approved design.
export const SEGMENTS =
  "w-full! max-w-80! [&_button]:flex-1! [&_button]:min-h-7! [&_button]:text-xs! [&_button]:px-2!";

export type ScopeMode = "luna" | "projects" | "both";
export type ScopePick = "all" | "some";
export type ScopeValue = { mode: ScopeMode; pick: ScopePick; selected: string[] };

export const DEFAULT_SCOPE: ScopeValue = { mode: "both", pick: "all", selected: [] };

export const SCOPE_ERROR = "Pick at least one project, or choose Luna.";

/** Projects (alone or with Luna) limited to chosen projects needs at least one. */
export function scopeInvalid(scope: ScopeValue) {
  return scope.mode !== "luna" && scope.pick === "some" && scope.selected.length === 0;
}

export function scopeFromConnector(connector: Pick<Connector, "luna" | "projects">): ScopeValue {
  const all = connector.projects === "all";
  const selected = all ? [] : [...(connector.projects as string[])];
  if (connector.luna && !all && selected.length === 0)
    return { mode: "luna", pick: "all", selected };
  return { mode: connector.luna ? "both" : "projects", pick: all ? "all" : "some", selected };
}

/** The request fields for a scope, or null when Projects needs a project it does not have. */
export function scopeToRequest(
  scope: ScopeValue,
): { luna: boolean; projects: ConnectorProjects } | null {
  if (scope.mode === "luna") return { luna: true, projects: [] };
  if (scopeInvalid(scope)) return null;
  return {
    luna: scope.mode === "both",
    projects: scope.pick === "all" ? "all" : scope.selected,
  };
}

export function scopeSummary(
  connector: Pick<Connector, "luna" | "projects">,
  projectNames: Map<string, string>,
): string {
  const { luna, projects } = connector;
  if (projects === "all") return luna ? "Luna and all projects" : "All projects";
  const names = projects.map((id) => projectNames.get(id)).filter((name): name is string => !!name);
  if (projects.length === 0) return luna ? "Luna only" : "Not available anywhere";
  const list =
    names.length === projects.length && names.length <= 2
      ? names.join(", ")
      : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;
  if (luna) return `Luna and ${list}`;
  return names.length === 1 && projects.length === 1 ? `${names[0]} only` : list;
}

export function keySummary(connector: Connector): string {
  if (connector.preset) return connector.keySet ? "Key saved" : "No key, free tier";
  return connector.transport === "stdio" ? "Local command" : "Remote URL";
}

export function targetLine(connector: Connector): string {
  if (connector.transport === "http") return connector.url ?? "";
  return joinCommand(connector.command ?? "", connector.args ?? []);
}

/** The server name the local service derives from a label, shown as the field's placeholder. */
export function deriveServerName(label: string): string {
  let name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) return "";
  if (!/^[a-z]/.test(name)) name = `mcp_${name}`;
  return name.slice(0, 40);
}

/** Splits a command line into the program and its arguments. Quotes group words; no shell runs. */
export function splitCommand(line: string): { command: string; args: string[] } {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  const [command = "", ...args] = words;
  return { command, args };
}

export function joinCommand(command: string, args: string[]): string {
  const quoteWord = (word: string) =>
    word === "" || /[\s"']/.test(word) ? (word.includes('"') ? `'${word}'` : `"${word}"`) : word;
  return [command, ...args]
    .filter((word, index) => index > 0 || word)
    .map(quoteWord)
    .join(" ");
}
