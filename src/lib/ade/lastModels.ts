import type { AgentId } from "@/lib/ade/types";

const LAST_MODEL_KEY = "ade-last-model-by-agent";

type LastModelMap = Partial<Record<AgentId, string>>;

function readMap(): LastModelMap {
  try {
    const raw = window.localStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LastModelMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key as AgentId] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: LastModelMap) {
  try {
    window.localStorage.setItem(LAST_MODEL_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Last model the user chose for this agent/provider (local only). */
export function readLastModel(agentId: AgentId): string | null {
  return readMap()[agentId] ?? null;
}

/** Remember the model used with this agent/provider. */
export function writeLastModel(agentId: AgentId, model: string) {
  const trimmed = model.trim();
  if (!trimmed) return;
  const next = { ...readMap(), [agentId]: trimmed };
  writeMap(next);
}

/**
 * Prefer an already-chosen model, else the last model for this agent, else the
 * first catalog entry. Empty string if nothing is available yet.
 */
export function resolveModelForAgent(
  agentId: AgentId,
  catalogIds: string[],
  current: string,
): string {
  const trimmed = current.trim();
  if (trimmed) return trimmed;
  const last = readLastModel(agentId);
  if (last) return last;
  return catalogIds[0] ?? "";
}
