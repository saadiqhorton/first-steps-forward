import { useEffect, useState } from "react";
import type { AgentSelection } from "@/components/ade/AgentPicker";
import { readLastModel, writeLastModel } from "@/lib/ade/lastModels";
import { useAdeState } from "@/lib/ade/store";
import { canAttemptAgent } from "@/shared/agent-availability.mjs";

/** The agent that builds a change: first ready agent by default, like a new project task. */
export function useAgentSelection(initialAgentId?: string) {
  const agents = useAdeState((state) => state.agents);
  const [selection, setSelection] = useState<AgentSelection>(() => {
    const agentId =
      initialAgentId ??
      agents.find((a) => a.installed && a.signedIn)?.id ??
      agents.find(canAttemptAgent)?.id ??
      agents[0]?.id ??
      "";
    return {
      agentId,
      model: readLastModel(agentId) ?? "",
      effort: "",
      speed: "",
      permission: "build",
    };
  });

  useEffect(() => {
    if (selection.model.trim()) writeLastModel(selection.agentId, selection.model);
  }, [selection.agentId, selection.model]);

  // Agents can still be loading at mount; fall back once they arrive, never over a user pick.
  useEffect(() => {
    if (agents.some((a) => a.id === selection.agentId)) return;
    const fallback =
      agents.find((a) => a.installed && a.signedIn)?.id ??
      agents.find(canAttemptAgent)?.id ??
      agents[0]?.id;
    if (!fallback) return;
    setSelection((prev) => ({
      ...prev,
      agentId: fallback,
      model: readLastModel(fallback) ?? "",
      effort: "",
      speed: "",
    }));
  }, [agents, selection.agentId]);

  const agent = agents.find((a) => a.id === selection.agentId);
  const unusableReason = !agent
    ? "No agent is available yet."
    : !agent.installed
      ? `${agent.name} is not installed. ${agent.installHint}`
      : !canAttemptAgent(agent)
        ? `${agent.name} must be signed in first. Open Agents settings to set it up.`
        : null;

  return { selection, setSelection, agent, unusableReason };
}
