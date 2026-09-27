import Markdown from "react-markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Message } from "@/lib/ade/types";

function isStructuredOutput(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    return typeof JSON.parse(trimmed) === "object";
  } catch {
    return false;
  }
}

export function SessionMessage({
  message,
  agentName,
}: {
  message: Message;
  agentName?: string | undefined;
}) {
  const { role, text } = message;
  const structured = role === "agent" && isStructuredOutput(text);
  const long =
    role === "agent" && (structured || text.length > 2400 || text.split("\n").length > 30);
  const lines = text.split("\n").length;
  const content = structured ? (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-ink/5 p-3 font-mono text-[11px] leading-relaxed">
      {text}
    </pre>
  ) : role === "agent" ? (
    <div className="ade-markdown break-words">
      <Markdown>{text}</Markdown>
    </div>
  ) : (
    <div className="whitespace-pre-wrap break-words">{text}</div>
  );

  return (
    <div className={`flex min-w-0 ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 max-w-[min(85%,100%)] overflow-hidden rounded-lg px-4 py-2.5 text-[13.5px] leading-relaxed [overflow-wrap:anywhere] ${role === "user" ? "bg-ink text-paper" : role === "system" ? "border border-amber/40 bg-amber/10" : "card-panel"}`}
      >
        {role !== "user" && (
          <div className="label-mono mb-1">{role === "system" ? "ADE" : agentName}</div>
        )}
        {long ? (
          <Collapsible>
            <p className="line-clamp-3 text-dim">{text.slice(0, 320)}</p>
            <CollapsibleTrigger className="mt-2 rounded text-left font-mono text-[11px] text-teal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal [&[data-state=open]_.show]:hidden [&[data-state=closed]_.hide]:hidden">
              <span className="show">
                Show {structured ? "structured output" : "full response"} · {lines} lines
              </span>
              <span className="hide">Hide details</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 min-w-0 border-t border-line pt-3">
              {content}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
