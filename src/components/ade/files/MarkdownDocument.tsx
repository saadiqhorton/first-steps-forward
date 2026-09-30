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
      className={`ade-markdown break-words ${compact ? "text-[11px] leading-snug [&_*]:!my-1" : "text-[13.5px] leading-relaxed"} ${className}`}
    >
      <Markdown>{content}</Markdown>
    </div>
  );
}
