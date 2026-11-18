import { FileAudio, FileCode2, FileImage, FileJson2, FileText, FileVideo } from "lucide-react";
import { mediaKindOf } from "@/shared/media-types.mjs";

export function editorFileIcon(file: string) {
  const media = mediaKindOf(file);
  if (media === "image") return <FileImage size={13} aria-hidden />;
  if (media === "video") return <FileVideo size={13} aria-hidden />;
  if (media === "audio") return <FileAudio size={13} aria-hidden />;
  if (file.endsWith(".json")) return <FileJson2 size={13} aria-hidden />;
  if (file.endsWith(".md") || file.endsWith(".txt") || file.endsWith(".mdx"))
    return <FileText size={13} aria-hidden />;
  return <FileCode2 size={13} aria-hidden />;
}
