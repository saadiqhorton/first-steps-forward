import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { editorRawUrl } from "@/lib/ade/editorApi";
import { entryPreviewsQuery } from "@/lib/ade/queries";
import { mediaKindOf } from "@/shared/media-types.mjs";
import { pauseGridSound } from "./sharedSound";

type Props = {
  projectId: string;
  path: string;
  visible: boolean;
};

function parentDir(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const FRAME = "max-h-full max-w-full rounded-[6px] border border-line object-contain";

/** Shows a picture, or plays a video or sound, from the project in a file tab. */
export function MediaTab({ projectId, path, visible }: Props) {
  const kind = mediaKindOf(path);
  const name = path.split("/").at(-1) ?? path;
  const previews = useQuery(entryPreviewsQuery(projectId, parentDir(path)));
  const preview = previews.data?.[path];
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  const setMedia = (node: HTMLMediaElement | null) => {
    mediaRef.current = node;
  };

  useEffect(() => {
    if (!visible) mediaRef.current?.pause();
  }, [visible]);

  // Wait for the folder's previews so the URL carries the file's version from the start
  // instead of loading the media twice.
  const url = previews.isPending ? "" : editorRawUrl(projectId, path, preview?.modifiedAt);

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${visible ? "flex" : "hidden"}`}
      aria-hidden={!visible}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-paper px-3 font-mono text-[11px] text-dim">
        <span className="min-w-0 truncate" title={path}>
          {path}
        </span>
        {preview && <span className="ml-auto shrink-0">{formatBytes(preview.size)}</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center overflow-auto p-6">
          {!url ? (
            <p className="font-mono text-[12px] text-dim">Opening file…</p>
          ) : failed ? (
            <p className="max-w-sm text-center font-mono text-[12px] text-amber">
              {kind === "image"
                ? "This picture could not be shown."
                : "This file could not be played."}
            </p>
          ) : kind === "image" ? (
            <img
              key={url}
              src={url}
              alt={name}
              draggable={false}
              onError={() => setFailed(true)}
              className={FRAME}
            />
          ) : kind === "video" ? (
            <video
              key={url}
              ref={setMedia}
              src={url}
              controls
              playsInline
              preload="metadata"
              onPlay={pauseGridSound}
              onError={() => setFailed(true)}
              className={`${FRAME} bg-deck`}
            />
          ) : (
            <figure className="flex w-full max-w-md flex-col gap-3">
              <figcaption className="truncate text-[13px] font-medium text-ink" title={path}>
                {name}
              </figcaption>
              <audio
                key={url}
                ref={setMedia}
                src={url}
                controls
                preload="metadata"
                onPlay={pauseGridSound}
                onError={() => setFailed(true)}
                className="w-full"
              />
            </figure>
          )}
        </div>
      </div>
    </div>
  );
}
