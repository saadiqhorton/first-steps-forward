import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownBlocks } from "@/lib/ade/markdownBlocks.mjs";

// Agents write GitHub-flavored Markdown (tables, task lists, strikethrough,
// bare links). Every Markdown surface in ADE renders through here so none of
// them silently falls back to plain CommonMark.
const remarkPlugins = [remarkGfm];

const Block = memo(function Block({
  text,
  components,
}: {
  text: string;
  components?: Components | undefined;
}) {
  return (
    <Markdown remarkPlugins={remarkPlugins} {...(components ? { components } : {})}>
      {text}
    </Markdown>
  );
});

export function AdeMarkdown({
  children,
  components,
  streaming = false,
}: {
  children: string;
  /** Keep it the same object between renders, or every block is parsed again. */
  components?: Components | undefined;
  /** The text is still being written: its finished blocks are not parsed again. */
  streaming?: boolean;
}) {
  if (!streaming) return <Block text={children} components={components} />;
  return markdownBlocks(children).map((text, index) => (
    <Block key={index} text={text} components={components} />
  ));
}
