import Markdown from "react-markdown";

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
      <Markdown>{content}</Markdown>
    </div>
  );
}
