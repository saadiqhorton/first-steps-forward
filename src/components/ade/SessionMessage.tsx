import Markdown from "react-markdown";
import type { ComponentPropsWithoutRef } from "react";
import { File } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  isPreviewableUrl,
  requestPreviewFileOpen,
  requestPreviewOpen,
  workspaceFileFromLink,
} from "@/lib/ade/browser/openInPreview.mjs";
import type { Message, MessageAttachment } from "@/lib/ade/types";
import { ContextPills } from "@/components/ade/ContextPills";

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
          className="flex max-w-56 items-center gap-2 rounded-md border border-line bg-panel px-2 py-1"
        >
          {a.kind === "image" ? (
            <img
              src={`/api/attachments/${a.id}`}
              alt={a.name}
              className="size-12 rounded-xs object-cover"
            />
          ) : (
            <File className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
          )}
          <span className="min-w-0 truncate text-xs" title={a.name}>
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

function AttachmentVideos({ attachments }: { attachments: MessageAttachment[] }) {
  return attachments
    .filter((attachment) => attachment.mime === "video/webm")
    .map((attachment) => (
      <video
        key={attachment.id}
        controls
        preload="metadata"
        className="mt-2 max-h-80 w-full rounded-md bg-black"
        src={`/api/attachments/${attachment.id}`}
        aria-label={attachment.name}
      />
    ));
}

export function SessionMessage({
  message,
  agentName,
  projectId,
}: {
  message: Message;
  agentName?: string | undefined;
  projectId?: string | undefined;
}) {
  const { role, attachments = [] } = message;
  const text = role === "user" && message.presentation ? message.presentation.text : message.text;
  const contextRow =
    role === "user" && message.presentation?.references.length ? (
      <div className="mb-2">
        <ContextPills items={message.presentation.references} />
      </div>
    ) : null;
  const structured = role === "agent" && isStructuredOutput(text);
  const lineCount = text.split("\n").length;
  // Only collapse JSON dumps — normal agent replies stay fully readable.
  const collapseAgent = structured;
  const longUser = role === "user" && (text.length > 480 || lineCount > 8);
  const attachmentRow = attachments.length ? <AttachmentChips attachments={attachments} /> : null;

  // Links open in ADE's browser tab, as T3 does: web addresses and local HTML/PDF files.
  const markdownLink = ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        if (typeof href !== "string") return;
        const web = isPreviewableUrl(href);
        const file = web ? null : workspaceFileFromLink(href);
        if (!web && !file) return;
        event.preventDefault();
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        if (web) {
          requestPreviewOpen(href);
          return;
        }
        if (file && projectId) requestPreviewFileOpen(projectId, file);
      }}
    >
      {children}
    </a>
  );

  const content = structured ? (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-ink/5 p-3 font-mono text-xs leading-relaxed">
      {text}
    </pre>
  ) : role === "agent" ? (
    <div className="ade-markdown break-words">
      <Markdown components={{ a: markdownLink }}>{text}</Markdown>
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
          <CollapsibleTrigger className="flex w-full flex-col items-stretch gap-2 rounded-xl bg-surface-muted px-4 py-2 text-left font-mono text-xs text-ink/80 transition-colors hover:text-ink [&[data-state=open]_.show]:hidden [&[data-state=closed]_.hide]:hidden">
            <span className="flex w-full items-center gap-2">
              <span className="show truncate">Your prompt · {lineCount} lines</span>
              <span className="hide">Hide prompt</span>
            </span>
            {contextRow}
            {attachmentRow}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 min-w-0 overflow-hidden rounded-xl data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down bg-surface-muted px-4 py-3 text-sm leading-5.5 text-ink [overflow-wrap:anywhere]">
            <div className="whitespace-pre-wrap break-words">{text}</div>
            <AttachmentVideos attachments={attachments} />
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // ADE's own notices sit in the margin of the conversation, quieter than replies.
  if (role === "system") {
    return (
      <div className="min-w-0 max-w-[min(85%,100%)] border-l-2 border-line pl-3 text-ui leading-5 text-[color:var(--text-secondary)] [overflow-wrap:anywhere]">
        <div className="label-section mb-1 text-dim">ADE</div>
        {content}
        {attachmentRow}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 max-w-[min(85%,100%)] overflow-hidden px-4 py-3 text-sm leading-5.5 [overflow-wrap:anywhere] ${role === "user" ? "rounded-xl bg-surface-muted text-ink" : "card-panel"}`}
      >
        {role === "agent" && <div className="label-section mb-1">{agentName}</div>}
        {collapseAgent ? (
          <Collapsible>
            <p className="line-clamp-3 font-mono text-xs text-dim">{text.slice(0, 320)}</p>
            <CollapsibleTrigger className="mt-2 rounded text-left font-mono text-xs text-teal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal [&[data-state=open]_.show]:hidden [&[data-state=closed]_.hide]:hidden">
              <span className="show">Show structured output · {lineCount} lines</span>
              <span className="hide">Hide details</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 min-w-0 overflow-hidden border-t border-line pt-3 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              {content}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            {contextRow}
            {content}
            {attachmentRow}
            <AttachmentVideos attachments={attachments} />
          </>
        )}
      </div>
    </div>
  );
}
