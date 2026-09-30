import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, GitBranch } from "lucide-react";
import { AgentPicker, agentChipLabel, type AgentSelection } from "@/components/ade/AgentPicker";
import { useAde } from "@/lib/ade/store";

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
}: {
  mode: "new" | "follow-up";
  selection: AgentSelection;
  onSelectionChange: (s: AgentSelection) => void;
  branch: string;
  disabledReason?: string;
  placeholder: string;
  sending: boolean;
  error?: string | null;
  onSend: (text: string) => Promise<boolean>;
  initialText?: string;
  extra?: ReactNode;
  agentLocked?: string;
}) {
  const { state } = useAde();
  const [text, setText] = useState(initialText ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const chip = agentChipLabel(selection, state.agents);
  const labelId = useId();
  const disabled = !!disabledReason || sending;
  const canSend = !!text.trim() && !disabled;

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
  }, [initialText]);

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

  const send = async () => {
    const outgoing = text.trim();
    if (!outgoing || disabled) return;
    const clear = await onSend(outgoing);
    if (clear) setText("");
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="card-panel overflow-visible has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-amber/35 has-[textarea:focus-visible]:ring-inset">
      {extra ? <div className="border-b border-line px-4 py-3">{extra}</div> : null}
      <label htmlFor={labelId} className="sr-only">
        {mode === "new" ? "Describe a change" : "Follow-up message"}
      </label>
      <textarea
        id={labelId}
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={!!disabledReason}
        placeholder={disabledReason ?? placeholder}
        rows={mode === "new" ? 3 : 1}
        className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[15px] leading-relaxed placeholder:text-dim/70 focus-visible:outline-none disabled:opacity-60"
      />
      {/*
        Anchor the picker to this footer only. A relative wrapper around the
        whole card (including acceptance-criteria `extra`) made bottom-full
        float the panel above that block mid-page.
      */}
      <div className="relative">
        {pickerOpen && (
          <div ref={pickerWrapRef} className="absolute inset-x-0 bottom-full z-30 mb-2">
            <AgentPicker
              value={selection}
              onChange={onSelectionChange}
              onClose={() => setPickerOpen(false)}
              {...(agentLocked ? { agentLocked } : {})}
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            ref={chipRef}
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="btn-quiet flex min-w-0 max-w-[55%] items-center gap-2 px-2.5 py-1.5 text-left"
          >
            <span className="min-w-0 truncate">
              <span className="block truncate text-[12.5px] font-medium leading-tight">
                {chip.title}
              </span>
              <span className="block truncate font-mono text-[10px] text-dim">{chip.subtitle}</span>
            </span>
          </button>
          <span
            className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-dim"
            title={`Branch ${branch}`}
          >
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{branch || "unknown"}</span>
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={sending ? "Sending" : "Send"}
            className="btn-amber ml-auto grid size-9 shrink-0 place-items-center disabled:opacity-60"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
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
