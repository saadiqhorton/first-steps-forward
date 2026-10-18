// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/PreviewChromeRow.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import {
  ArrowLeft,
  ArrowRight,
  Expand,
  ExternalLink,
  PictureInPicture2,
  RotateCw,
  Shrink,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  pictureInPictureKey,
  subscribePictureInPicture,
  supportsPictureInPicture,
} from "@/lib/ade/browser/pictureInPicture";
import { openExternally, togglePictureInPicture } from "./browserActions";
import { useBrowserPreview } from "./browserPreviewContext";

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:pointer-events-none disabled:opacity-40";

/**
 * Address bar for the docked browser: history, reload, the page address (editable only while
 * you hold control), and the pop-out, picture-in-picture and full screen actions.
 */
export function BrowserChromeRow({ frameRef }: { frameRef: RefObject<HTMLDivElement | null> }) {
  const preview = useBrowserPreview();
  const { nav, control, projectId, canvas, send } = preview;
  const canOperate = control?.controller === "you";
  const url = nav?.url ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [pipError, setPipError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pipActive = useSyncExternalStore(
    subscribePictureInPicture,
    () => pictureInPictureKey() === projectId,
  );

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [frameRef]);

  const takeToNavigate = canOperate ? undefined : "Take over to navigate";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = (draft ?? "").trim();
    if (next) send({ type: "navigate", url: next });
    setDraft(null);
    inputRef.current?.blur();
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setDraft(null);
    inputRef.current?.blur();
  };

  const togglePip = () => {
    setPipError("");
    if (!canvas || !projectId) return;
    togglePictureInPicture(projectId, canvas).catch((error: unknown) =>
      setPipError(error instanceof Error ? error.message : "Could not open a floating window."),
    );
  };

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement === frame) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void frame.requestFullscreen().catch(() => undefined);
    }
  };

  return (
    <>
      <div className="relative flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <button
          type="button"
          aria-label="Back"
          title={takeToNavigate ?? "Back"}
          disabled={!canOperate || !nav?.canGoBack}
          onClick={() => send({ type: "history", delta: -1 })}
          className={ICON_BUTTON}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          title={takeToNavigate ?? "Forward"}
          disabled={!canOperate || !nav?.canGoForward}
          onClick={() => send({ type: "history", delta: 1 })}
          className={ICON_BUTTON}
        >
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Reload"
          title={takeToNavigate ?? "Reload"}
          disabled={!canOperate}
          onClick={() => send({ type: "reload" })}
          className={ICON_BUTTON}
        >
          <RotateCw className="size-3.5" aria-hidden />
        </button>

        <form onSubmit={submit} className="flex min-w-0 flex-1">
          <input
            ref={inputRef}
            aria-label="Page address"
            value={draft ?? url}
            readOnly={!canOperate}
            placeholder={url ? undefined : "Waiting for the page"}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={handleKey}
            className="h-7 w-full min-w-0 rounded-md bg-paper px-2.5 font-mono text-[12px] text-ink ring-1 ring-line ring-inset outline-none placeholder:text-dim read-only:text-dim focus-visible:outline-2 focus-visible:outline-amber"
          />
        </form>

        <button
          type="button"
          aria-label="Open in browser"
          title="Open in your browser"
          disabled={!/^https?:\/\//i.test(url)}
          onClick={() => openExternally(url)}
          className={ICON_BUTTON}
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Pop out to floating window"
          title="Pop out to floating window"
          onClick={() => preview.setPlace("float")}
          className={ICON_BUTTON}
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden />
        </button>
        {supportsPictureInPicture() ? (
          <button
            type="button"
            aria-label={pipActive ? "Close picture in picture" : "Picture in picture"}
            aria-pressed={pipActive}
            title={pipActive ? "Close picture in picture" : "Picture in picture"}
            disabled={!canvas}
            onClick={togglePip}
            className={`${ICON_BUTTON} ${pipActive ? "text-amber" : ""}`}
          >
            <PictureInPicture2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
          className={ICON_BUTTON}
        >
          {fullscreen ? (
            <Shrink className="size-3.5" aria-hidden />
          ) : (
            <Expand className="size-3.5" aria-hidden />
          )}
        </button>

        {nav?.loading ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-amber motion-safe:animate-pulse"
          />
        ) : null}
      </div>
      {pipError ? (
        <p
          role="alert"
          className="border-b border-line bg-panel px-3 py-1.5 text-[11px] text-danger"
        >
          {pipError}
        </p>
      ) : null}
    </>
  );
}
