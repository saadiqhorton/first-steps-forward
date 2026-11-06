import { FileCode2, FileJson2, FileText } from "lucide-react";

export function editorFileIcon(file: string) {
  if (file.endsWith(".json")) return <FileJson2 size={13} aria-hidden />;
  if (file.endsWith(".md") || file.endsWith(".txt") || file.endsWith(".mdx"))
    return <FileText size={13} aria-hidden />;
  return <FileCode2 size={13} aria-hidden />;
}
