import { useState } from "react";
import type { BrowserDialog } from "@/lib/ade/browser/browserStream";

/**
 * A page dialog (alert, confirm, prompt or beforeunload) that the page is waiting on. The page is
 * frozen until someone answers, so this is shown whoever holds control.
 */
export function PageDialog({
  dialog,
  onAnswer,
}: {
  dialog: BrowserDialog;
  onAnswer: (reply: { accept: boolean; promptText?: string }) => void;
}) {
  const [text, setText] = useState(dialog.defaultValue);
  const isPrompt = dialog.type === "prompt";
  const isAlert = dialog.type === "alert";
  return (
    <div
      role="dialog"
      aria-label="Page dialog"
      className="absolute top-1/2 left-1/2 z-[7] grid w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl bg-panel p-3 text-xs text-ink shadow-lg ring-1 ring-line ring-inset"
    >
      <p className="m-0 break-words">{dialog.message || "The page is asking for a response."}</p>
      {isPrompt ? (
        <input
          aria-label="Dialog response"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-7 w-full min-w-0 rounded-md bg-paper px-2 ring-1 ring-line ring-inset outline-none focus-visible:outline-2 focus-visible:outline-amber"
        />
      ) : null}
      <div className="flex justify-end gap-2">
        {isAlert ? null : (
          <button
            type="button"
            onClick={() => onAnswer({ accept: false })}
            className="btn-quiet px-3 py-1.5 text-xs"
          >
            Dismiss
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer({ accept: true, ...(isPrompt ? { promptText: text } : {}) })}
          className="btn-amber px-3 py-1.5 text-xs"
        >
          {isAlert ? "OK" : "Accept"}
        </button>
      </div>
    </div>
  );
}
