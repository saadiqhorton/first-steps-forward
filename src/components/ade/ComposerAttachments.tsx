import { File, Paperclip, X } from "lucide-react";
import type { RefObject } from "react";
import { recordingAttachment } from "@/lib/ade/browser/recordingUpload";

export type AttachmentDraft = {
  key: string;
  file: File;
  previewUrl?: string;
};

function formatSize(bytes: number) {
  const n = Number(bytes) || 0;
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function ComposerAttachments({
  drafts,
  disabled,
  onAddFiles,
  onRemove,
  fileInputRef,
  dragging,
}: {
  drafts: AttachmentDraft[];
  disabled?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  dragging: boolean;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const list = e.target.files ? [...e.target.files] : [];
          if (list.length) onAddFiles(list);
          e.target.value = "";
        }}
      />
      {drafts.length ? (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {drafts.map((draft) => {
            const name = draft.file.name;
            return (
              <div
                key={draft.key}
                className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5"
              >
                {draft.previewUrl ? (
                  <img src={draft.previewUrl} alt="" className="size-10 rounded object-cover" />
                ) : (
                  <File className="size-4 shrink-0 text-dim" aria-hidden />
                )}
                <span className="min-w-0 truncate text-[12px]" title={name}>
                  {name}
                  {!draft.previewUrl ? (
                    <span className="text-dim">
                      {" "}
                      · {formatSize(recordingAttachment(draft.file)?.size ?? draft.file.size)}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="btn-quiet grid size-6 shrink-0 place-items-center"
                  aria-label={`Remove ${name}`}
                  disabled={disabled}
                  onClick={() => onRemove(draft.key)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] border border-amber/40 bg-amber/10 text-[13px] text-ink">
          Drop files to attach
        </div>
      ) : null}
    </>
  );
}

export function ComposerAttachButton({
  disabled,
  atLimit,
  fileInputRef,
}: {
  disabled?: boolean;
  atLimit: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={disabled || atLimit}
      aria-label="Attach files"
      className="btn-quiet grid size-9 shrink-0 place-items-center disabled:opacity-60"
    >
      <Paperclip className="size-4" aria-hidden />
    </button>
  );
}
