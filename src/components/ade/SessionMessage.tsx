import Markdown from "react-markdown";
import { File } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Message, MessageAttachment } from "@/lib/ade/types";

function formatAttachmentSize(bytes: number) {
  const n = Number(bytes) || 0;
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function isStructuredOutput(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    return typeof JSON.parse(trimmed) === "object";
  } catch {
    return false;
  }
}

function AttachmentChips({ attachments }: { attachments: MessageAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5"
        >
          {a.kind === "image" ? (
            <img
              src={`/api/attachments/${a.id}`}
              alt={a.name}
              className="size-12 rounded object-cover"
            />
          ) : (
            <File className="size-4 shrink-0 text-dim" aria-hidden />
          )}
          <span className="min-w-0 truncate text-[12px]" title={a.name}>
            {a.name}
            {a.kind === "file" ? (
              <span className="text-dim"> · {formatAttachmentSize(a.size)}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SessionMessage({
  message,
  agentName,
}: {
  message: Message;
  agentName?: string | undefined;
}) {
  const { role, text, attachments = [] } = message;
  const structured = role === "agent" && isStructuredOutput(text);
  const lineCount = text.split("\n").length;
  // Only collapse JSON dumps — normal agent replies stay fully readable.
  const collapseAgent = structured;
  const longUser = role === "user" && (text.length > 480 || lineCount > 8);
  const attachmentRow = attachments.length ? <AttachmentChips attachments={attachments} /> : null;

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

  // Long user prompts: compact one-line chip until expanded (avoids a dark wall
  // that duplicates the session header).
  if (longUser) {
    return (
      <div className="flex min-w-0 justify-end">
        <Collapsible className="min-w-0 max-w-[min(85%,100%)]">
          <CollapsibleTrigger className="flex w-full flex-col items-stretch gap-2 rounded-lg bg-surface-muted px-3.5 py-2 text-left font-mono text-[11px] text-ink/80 transition-colors hover:text-ink [&[data-state=open]_.show]:hidden [&[data-state=closed]_.hide]:hidden">
            <span className="flex w-full items-center gap-2">
              <span className="show truncate">Your prompt · {lineCount} lines</span>
              <span className="hide">Hide prompt</span>
            </span>
            {attachmentRow}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 min-w-0 overflow-hidden rounded-lg data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down bg-surface-muted px-4 py-2.5 text-[13.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">
            <div className="whitespace-pre-wrap break-words">{text}</div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 max-w-[min(85%,100%)] overflow-hidden rounded-lg px-4 py-2.5 text-[13.5px] leading-relaxed [overflow-wrap:anywhere] ${role === "user" ? "bg-surface-muted text-ink" : role === "system" ? "border border-amber/40 bg-amber/10" : "card-panel"}`}
      >
        {role !== "user" && (
          <div className="label-mono mb-1">{role === "system" ? "ADE" : agentName}</div>
        )}
        {collapseAgent ? (
          <Collapsible>
            <p className="line-clamp-3 font-mono text-[11px] text-dim">{text.slice(0, 320)}</p>
            <CollapsibleTrigger className="mt-2 rounded text-left font-mono text-[11px] text-teal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal [&[data-state=open]_.show]:hidden [&[data-state=closed]_.hide]:hidden">
              <span className="show">Show structured output · {lineCount} lines</span>
              <span className="hide">Hide details</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 min-w-0 overflow-hidden border-t border-line pt-3 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              {content}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            {content}
            {attachmentRow}
          </>
        )}
      </div>
    </div>
  );
}
