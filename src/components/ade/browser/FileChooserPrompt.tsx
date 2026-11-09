import { useRef } from "react";
import { Upload } from "lucide-react";
import type { BrowserFileChooser } from "@/lib/ade/browser/browserStream";

/**
 * A file picker the page opened. Headless Chrome has no native picker, so the files come from
 * this machine's own picker and are sent to the page; answering takes control first.
 */
export function FileChooserPrompt({
  chooser,
  onAnswer,
}: {
  chooser: BrowserFileChooser;
  onAnswer: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      role="dialog"
      aria-label="Page file picker"
      className="absolute top-1/2 left-1/2 z-[7] grid w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl bg-panel p-3 text-xs text-ink shadow-lg ring-1 ring-line ring-inset"
    >
      <p className="m-0 break-words">
        The page wants {chooser.multiple ? "files" : "a file"}. Choose{" "}
        {chooser.multiple ? "them" : "one"} from this computer to send to it.
      </p>
      <input
        ref={input}
        type="file"
        hidden
        multiple={chooser.multiple}
        accept={chooser.accept || undefined}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onAnswer(files);
        }}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onAnswer([])}
          className="btn-quiet px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="btn-amber inline-flex items-center gap-2 px-3 py-1.5 text-xs"
        >
          <Upload className="size-4" strokeWidth={1.5} aria-hidden />
          {chooser.multiple ? "Choose files" : "Choose file"}
        </button>
      </div>
    </div>
  );
}
