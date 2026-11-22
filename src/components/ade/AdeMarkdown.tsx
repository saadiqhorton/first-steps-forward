import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Agents write GitHub-flavored Markdown (tables, task lists, strikethrough,
// bare links). Every Markdown surface in ADE renders through here so none of
// them silently falls back to plain CommonMark.
const remarkPlugins = [remarkGfm];

export function AdeMarkdown({
  children,
  components,
}: {
  children: string;
  components?: Components;
}) {
  return (
    <Markdown remarkPlugins={remarkPlugins} {...(components ? { components } : {})}>
      {children}
    </Markdown>
  );
}
