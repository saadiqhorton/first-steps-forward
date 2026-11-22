import { AdeMarkdown } from "@/components/ade/AdeMarkdown";

export function MarkdownDocument({
  content,
  className = "",
  compact = false,
}: {
  content: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`ade-markdown break-words ${compact ? "text-caption leading-snug [&_*]:!my-1" : "text-sm leading-relaxed"} ${className}`}
    >
      <AdeMarkdown>{content}</AdeMarkdown>
    </div>
  );
}
