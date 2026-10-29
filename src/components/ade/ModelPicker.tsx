import { useEffect, useState } from "react";
import { agentModels } from "@/lib/ade/store";
import type { AgentId, AgentModelsResult } from "@/lib/ade/types";

const OTHER = "__other__";
export const REASON_TEXT: Record<string, string> = {
  "not-installed": "This CLI is not installed, so ADE cannot list its models.",
  "cli-failed": "The CLI's model listing command failed or printed something unexpected.",
  "no-providers-configured": "This CLI returned no models in its catalog.",
  empty: "The CLI returned an empty model list.",
  "unknown-agent": "Model listing is not supported for this agent.",
  "acp-not-reported": "This agent has not listed its models yet.",
  "acp-probe-failed": "ADE could not read this agent's model list.",
  "acp-no-models": "This agent offers no model choice.",
};

/**
 * Dependent-on-agent model picker. Reads the CLI's own cached, quota-free
 * model list through /api/agents/:id/models; when listing is unavailable it
 * falls back to manual free-text entry with the honest reason. Value is the
 * exact model id to pass to the CLI, or "" meaning "agent's configured
 * default" (the flag is then omitted entirely).
 */
export function ModelPicker({
  agentId,
  agentName,
  value,
  onChange,
  idSuffix = "",
}: {
  agentId: AgentId;
  agentName: string;
  value: string;
  onChange: (model: string) => void;
  idSuffix?: string;
}) {
  const [result, setResult] = useState<AgentModelsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setShowOther(false);
    setOtherText("");
    agentModels(agentId)
      .then((r) => !cancelled && setResult(r))
      .catch(
        (e) =>
          !cancelled &&
          setResult({
            available: false,
            reason: "cli-failed",
            hint: e instanceof Error ? e.message : String(e),
          }),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [agentId]);
  const listed = !!result?.models?.some((m) => m.id === value);
  // An explicit model always wins: a value that is not in the (possibly
  // stale) catalog stays editable rather than being gated away.
  const manualActive = showOther || (!!value && !listed);
  const selectValue = manualActive ? OTHER : value;
  const inputId = `model-${agentId}${idSuffix}`;
  const textId = `model-other-${agentId}${idSuffix}`;
  const manualInput = (
    <input
      id={textId}
      value={otherText || value}
      onChange={(e) => {
        setOtherText(e.target.value);
        onChange(e.target.value.trim());
      }}
      maxLength={256}
      placeholder="e.g. provider/model-id"
      className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[12.5px] placeholder:text-dim/70"
    />
  );
  return (
    <div>
      <label className="label-mono block" htmlFor={inputId}>
        Model
      </label>
      {loading ? (
        <p className="mt-2 font-mono text-[11px] text-dim">Reading {agentName}'s model list…</p>
      ) : result?.available ? (
        <>
          <select
            id={inputId}
            value={selectValue}
            onChange={(e) => {
              const next = e.target.value;
              if (next === OTHER) {
                // Re-commit any existing draft so the manual input's displayed
                // text and the applied value cannot diverge (type O, pick
                // listed L, reselect Other -> commits O, not L).
                if (otherText) onChange(otherText.trim());
                setShowOther(true);
              } else {
                setShowOther(false);
                onChange(next);
              }
            }}
            className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[13px]"
          >
            <option value="">Default (agent's configured model)</option>
            {(result.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label && m.label !== m.id ? `${m.label} — ${m.id}` : m.id}
                {m.meta ? ` (${m.meta})` : ""}
              </option>
            ))}
            <option value={OTHER}>Other model id…</option>
          </select>
          {selectValue === OTHER && manualInput}
          {result.source === "bundled" && (
            <p className="mt-1 font-mono text-[10.5px] text-dim">
              Served from the CLI's offline bundled catalog — it may omit newer models.
            </p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-dim">
            {agentId === "pi" ? (
              <>
                Pi's cached model catalog (no quota used) can list models from providers that are
                not READY for Pi. The READY provider count shown by ADE comes from Pi's auth check,
                not this model list. A listed model is not a guarantee of entitlement.
              </>
            ) : result.source === "acp" ? (
              <>
                The models {agentName} itself reports offering. ADE applies the one you pick through
                the agent's own model setting.
              </>
            ) : (
              <>
                Read from {agentName}'s own cached catalog (no quota used); only providers
                configured in that CLI are listed. A listed model is not a guarantee of entitlement
                — availability depends on your account.
              </>
            )}{" "}
            Leaving this unset uses the agent's configured default.
          </p>
        </>
      ) : (
        <>
          {manualInput}
          <p className="mt-2 rounded-md bg-amber/10 px-3 py-2 text-[12px] leading-relaxed">
            <span className="font-medium">
              {REASON_TEXT[result?.reason ?? ""] ?? "Model listing is unavailable."}
            </span>{" "}
            {result?.hint ??
              "You can enter a model id manually; availability depends on your account."}
          </p>
        </>
      )}
    </div>
  );
}
