import { request } from "./api";

export type ConnectorPresetId = "parallel" | "exa" | "firecrawl";
export type ConnectorTransport = "http" | "stdio";
/** "all" or the ids of the chosen projects; [] means no projects. */
export type ConnectorProjects = "all" | string[];

/** A saved header or environment variable. The value never leaves the local service. */
export type ConnectorSecretRef = { name: string; set: boolean };

export type Connector = {
  id: string;
  /** The MCP server name agents see. */
  name: string;
  label: string;
  preset?: ConnectorPresetId;
  transport: ConnectorTransport;
  url?: string;
  headers?: ConnectorSecretRef[];
  command?: string;
  args?: string[];
  env?: ConnectorSecretRef[];
  enabled: boolean;
  luna: boolean;
  projects: ConnectorProjects;
  /** Presets: whether the preset's key header has a value. */
  keySet?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ConnectorPreset = {
  id: ConnectorPresetId;
  label: string;
  description: string;
  url: string;
  keyHeader: string;
  keyOptional: true;
  keyUrl: string;
};

export type ConnectorsResponse = { connectors: Connector[]; presets: ConnectorPreset[] };

type Scope = { luna?: boolean; projects?: ConnectorProjects };

export type AddPresetInput = Scope & { preset: ConnectorPresetId; apiKey?: string; url?: string };

export type AddCustomInput = Scope & {
  label: string;
  name?: string;
  transport: ConnectorTransport;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * Secret maps: a non-empty string sets the value, "" keeps the saved one, null removes it.
 * `apiKey` (presets): non-empty sets, null removes, absent or "" keeps.
 */
export type ConnectorPatch = Scope & {
  label?: string;
  enabled?: boolean;
  url?: string;
  apiKey?: string | null;
  headers?: Record<string, string | null>;
  command?: string;
  args?: string[];
  env?: Record<string, string | null>;
};

export type ConnectorTestResult = { ok: true; tools: string[] } | { ok: false; error: string };

export const CONNECTORS_QUERY_KEY = ["connectors"] as const;

export function getConnectors() {
  return request<ConnectorsResponse>("/api/connectors");
}

export function addConnector(input: AddPresetInput | AddCustomInput) {
  return request<{ connector: Connector }>("/api/connectors", "POST", input);
}

export function updateConnector(id: string, patch: ConnectorPatch) {
  return request<{ connector: Connector }>(
    `/api/connectors/${encodeURIComponent(id)}`,
    "PATCH",
    patch,
  );
}

export function removeConnector(id: string) {
  return request<{ ok: true }>(`/api/connectors/${encodeURIComponent(id)}`, "DELETE");
}

export function testConnector(id: string) {
  return request<ConnectorTestResult>(`/api/connectors/${encodeURIComponent(id)}/test`, "POST");
}
