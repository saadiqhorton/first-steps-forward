import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, GitBranch, Sparkles, X } from "lucide-react";
import { AgentPicker, agentChipLabel, type AgentSelection } from "@/components/ade/AgentPicker";
import type { Workflow } from "@/lib/ade/types";
import {
  ComposerAttachButton,
  ComposerAttachments,
  type AttachmentDraft,
} from "@/components/ade/ComposerAttachments";
import { warnUser } from "@/components/ade/NoticeDialog";
import { useAde } from "@/lib/ade/store";

const PICKER_MAX_WIDTH = 960;
const PICKER_EDGE = 16;
const PICKER_GAP = 8;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TURN_BYTES = 20 * 1024 * 1024;

type PickerBox = { left: number; bottom: number; width: number };

function draftKey(file: File, index: number) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(index);
  return `${file.name}:${file.size}:${file.lastModified}:${suffix}`;
}

export function Composer({
  mode,
  selection,
  onSelectionChange,
  branch,
  disabledReason,
  placeholder,
  sending,
  error,
  onSend,
  initialText,
  extra,
  agentLocked,
  running = false,
  workflow,
  onWorkflowRemove,
}: {
  mode: "new" | "follow-up";
  selection: AgentSelection;
  onSelectionChange: (s: AgentSelection) => void;
  branch: string;
  disabledReason?: string;
  placeholder: string;
  sending: boolean;
  error?: string | null;
  onSend: (text: string, files: File[], delivery?: "now" | "later") => Promise<boolean>;
  initialText?: string;
  extra?: ReactNode;
  agentLocked?: string;
  /** While a turn is running, the composer offers wait-and-send and send-now. */
  running?: boolean;
  /** A selected workflow renders as a token; its prompt is sent with the draft. */
  workflow?: Workflow | null;
  onWorkflowRemove?: () => void;
}) {
  const { state } = useAde();
  const [text, setText] = useState(initialText ?? "");
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerBox, setPickerBox] = useState<PickerBox | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const chip = agentChipLabel(selection, state.agents);
  const labelId = useId();
  const disabled = !!disabledReason || sending;
  const workflowPrompt = workflow?.prompt.trim() ?? "";
  const canSend = (!!text.trim() || !!workflowPrompt) && !disabled;

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    return () => {
      for (const draft of draftsRef.current) {
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, mode === "new" ? 72 : 44)}px`;
  }, [text, mode]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (pickerWrapRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  useLayoutEffect(() => {
    if (!pickerOpen) {
      setPickerBox(null);
      return;
    }
    const place = () => {
      const footer = footerRef.current;
      if (!footer) return;
      const rect = footer.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const width = Math.min(PICKER_MAX_WIDTH, viewport - PICKER_EDGE * 2);
      const centered = rect.left + rect.width / 2 - width / 2;
      const left = Math.min(Math.max(centered, PICKER_EDGE), viewport - PICKER_EDGE - width);
      setPickerBox({ left, width, bottom: window.innerHeight - rect.top + PICKER_GAP });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [pickerOpen]);

  const addFiles = (incoming: File[]) => {
    if (disabled) return;
    const oversized: string[] = [];
    setDrafts((prev) => {
      let next = [...prev];
      let totalBytes = next.reduce((sum, d) => sum + d.file.size, 0);
      for (const [index, file] of incoming.entries()) {
        if (!file.size) continue;
        if (next.length >= MAX_FILES) break;
        if (file.size > MAX_FILE_BYTES) {
          oversized.push(file.name);
          continue;
        }
        if (totalBytes + file.size > MAX_TURN_BYTES) continue;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        next = [
          ...next,
          { key: draftKey(file, index), file, ...(previewUrl ? { previewUrl } : {}) },
        ];
        totalBytes += file.size;
      }
      return next;
    });
    for (const name of oversized) void warnUser(`${name} is larger than 10 MB.`);
  };

  const removeDraft = (key: string) => {
    setDrafts((prev) => {
      const draft = prev.find((d) => d.key === key);
      if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      return prev.filter((d) => d.key !== key);
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = event.clipboardData;
    if (!dt) return;
    const files = dt.files?.length ? [...dt.files] : [];
    const imageItems = [...dt.items].filter((item) => item.type.startsWith("image/"));
    if (!files.length && !imageItems.length) return;
    event.preventDefault();
    if (files.length) {
      addFiles(files);
      return;
    }
    const fromItems = imageItems.map((item) => item.getAsFile()).filter((f): f is File => !!f);
    if (fromItems.length) addFiles(fromItems);
  };

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = event.dataTransfer.files?.length ? [...event.dataTransfer.files] : [];
    if (files.length) addFiles(files);
  };

  const send = async (delivery?: "now" | "later") => {
    const outgoing = [workflowPrompt, text.trim()].filter(Boolean).join("\n\n");
    if (!outgoing || disabled) return;
    const files = drafts.map((d) => d.file);
    const clear = await onSend(outgoing, files, running ? (delivery ?? "later") : undefined);
    if (clear) {
      setText("");
      onWorkflowRemove?.();
      setDrafts((prev) => {
        for (const draft of prev) {
          if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
        }
        return [];
      });
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(running ? "later" : undefined);
  };

  return (
    <div
      className="card-panel relative overflow-visible has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-amber/35 has-[textarea:focus-visible]:ring-inset @container/composer"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {extra ? <div className="border-b border-line px-4 py-3">{extra}</div> : null}
      <label htmlFor={labelId} className="sr-only">
        {mode === "new"
          ? workflow
            ? "Add instructions for the selected workflow"
            : "Describe a change"
          : "Follow-up message"}
      </label>
      {workflow ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <span
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 py-1 pr-1 pl-2.5 text-[12px] text-ink"
            title={workflow.description || workflow.name}
          >
            <Sparkles className="size-3.5 shrink-0 text-amber-deep" aria-hidden />
            <span className="min-w-0 truncate font-medium">{workflow.name}</span>
            <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.08em] text-dim uppercase @[18rem]/composer:inline">
              Workflow
            </span>
            {onWorkflowRemove ? (
              <button
                type="button"
                onClick={onWorkflowRemove}
                disabled={disabled}
                aria-label={`Remove ${workflow.name} workflow`}
                className="grid size-6 shrink-0 place-items-center rounded-full text-dim transition hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/40 disabled:opacity-60"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      <textarea
        id={labelId}
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        disabled={!!disabledReason}
        placeholder={
          disabledReason ??
          (workflow ? "Add instructions for this workflow (optional)…" : placeholder)
        }
        rows={mode === "new" ? 3 : 1}
        className={`block w-full resize-none bg-transparent px-4 ${workflow ? "pt-2" : "pt-3"} pb-2 text-[15px] leading-relaxed placeholder:text-dim/70 focus-visible:outline-none disabled:opacity-60`}
      />
      <ComposerAttachments
        drafts={drafts}
        disabled={disabled}
        onAddFiles={addFiles}
        onRemove={removeDraft}
        fileInputRef={fileInputRef}
        dragging={dragging}
      />
      {running ? (
        <p className="px-4 pb-1 text-[12px] leading-relaxed text-dim">
          Send later waits until this step finishes. Send now stops this step and uses your message.
        </p>
      ) : null}
      <div ref={footerRef}>
        {pickerOpen &&
          pickerBox &&
          createPortal(
            <div
              ref={pickerWrapRef}
              className="fixed z-50"
              style={{ left: pickerBox.left, bottom: pickerBox.bottom, width: pickerBox.width }}
            >
              <AgentPicker
                value={selection}
                onChange={onSelectionChange}
                onClose={() => setPickerOpen(false)}
                {...(agentLocked ? { agentLocked } : {})}
              />
            </div>,
            document.body,
          )}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <button
            ref={chipRef}
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="btn-quiet flex min-w-0 max-w-[55%] items-center gap-2 px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/40 aria-expanded:bg-ink/[0.06]"
          >
            <span className="min-w-0 truncate">
              <span className="block truncate text-[12.5px] font-medium leading-tight">
                {chip.title}
              </span>
              <span className="block truncate font-mono text-[10px] text-dim">{chip.subtitle}</span>
            </span>
          </button>
          <span
            className="@max-[22rem]/composer:hidden flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-dim"
            title={`Branch ${branch}`}
          >
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{branch || "unknown"}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ComposerAttachButton
              disabled={disabled}
              atLimit={drafts.length >= MAX_FILES}
              fileInputRef={fileInputRef}
            />
            {running ? (
              <>
                <button
                  type="button"
                  onClick={() => void send("later")}
                  disabled={!canSend}
                  className="btn-quiet px-3 py-1.5 text-[12px] disabled:opacity-60"
                >
                  Send later
                </button>
                <button
                  type="button"
                  onClick={() => void send("now")}
                  disabled={!canSend}
                  className="btn-amber px-3 py-1.5 text-[12px] disabled:opacity-60"
                >
                  Send now
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                aria-label={sending ? "Sending" : "Send"}
                className="btn-amber grid size-9 shrink-0 place-items-center disabled:opacity-60"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="border-t border-line px-4 py-2 text-[12px] leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
