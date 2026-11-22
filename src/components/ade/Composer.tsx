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
import { ArrowUp, AtSign, GitBranch } from "lucide-react";
import { AgentPicker, agentChipLabel, type AgentSelection } from "@/components/ade/AgentPicker";
import { useAdeState } from "@/lib/ade/store";
import type { ContextReference, MessagePresentation, Workflow } from "@/lib/ade/types";
import { ContextPills } from "@/components/ade/ContextPills";
import { DictationControl } from "@/components/ade/DictationControl";
import { useDictation } from "@/lib/ade/dictation/useDictation";
import { composeDictation } from "@/lib/ade/dictation/dictation.mjs";
import {
  ComposerAttachButton,
  ComposerAttachments,
  type AttachmentDraft,
} from "@/components/ade/ComposerAttachments";
import { warnUser } from "@/lib/ade/userNotices";
import {
  ComposerSuggestions,
  useComposerSuggestions,
  type Suggestion,
} from "./ComposerSuggestions";
import {
  composerTrigger,
  replaceComposerTrigger,
  type ComposerTrigger,
} from "./composerSuggestions.mjs";
import {
  isBrowserRecording,
  ensureBrowserFeedbackLoaded,
  finishBrowserFeedbackTransfer,
  MAX_BROWSER_RECORDING_BYTES,
  peekBrowserFeedback,
  saveComposerDraft,
  subscribeBrowserFeedback,
  takeBrowserFeedback,
} from "@/lib/ade/browser/composerFeedback";
import { feedbackBatchSize } from "@/lib/ade/browser/feedbackBatch.mjs";
import {
  loadFeedbackDraft,
  persistFeedbackFile,
  restoreFeedbackFile,
} from "@/lib/ade/browser/feedbackPersistence";
const PICKER_MAX_WIDTH = 1080;
const PICKER_EDGE = 16;
const PICKER_GAP = 8;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TURN_BYTES = 20 * 1024 * 1024;
const toolButtonClass =
  "grid size-9 shrink-0 place-items-center rounded-md bg-transparent text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 disabled:opacity-50 motion-reduce:transition-none";

type PickerBox = { left: number; bottom: number; width: number; maxHeight: number };
type ContextItem = ContextReference & { prompt?: string };

function draftKey(file: File, index: number) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(index);
  return `${file.name}:${file.size}:${file.lastModified}:${suffix}`;
}

export function Composer({
  projectId,
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
  onWorkflowSelect,
  sessionId,
  draftStorageKey,
  compact = false,
}: {
  projectId?: string;
  mode: "new" | "follow-up";
  selection: AgentSelection;
  onSelectionChange: (s: AgentSelection) => void;
  branch: string;
  disabledReason?: string;
  placeholder: string;
  sending: boolean;
  error?: string | null;
  onSend: (
    text: string,
    files: File[],
    delivery?: "now" | "later",
    presentation?: MessagePresentation,
  ) => Promise<boolean>;
  initialText?: string;
  extra?: ReactNode;
  agentLocked?: string;
  /** While a turn is running, the composer offers wait-and-send and send-now. */
  running?: boolean;
  /** A selected workflow renders as a token; its prompt is sent with the draft. */
  workflow?: Workflow | null;
  onWorkflowRemove?: () => void;
  onWorkflowSelect?: (workflow: Workflow) => void;
  sessionId?: string;
  draftStorageKey?: string;
  /** Use a shorter initial textarea for a dense, guided new-task surface. */
  compact?: boolean;
}) {
  const agents = useAdeState((state) => state.agents);
  const [text, setText] = useState(initialText ?? "");
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [draftReady, setDraftReady] = useState(!draftStorageKey);
  const draftStorageWarning = useRef(false);
  const draftRestoreFailed = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const draftsRef = useRef(drafts);
  const feedbackLimitWarned = useRef(false);
  // A burst of feedback events can arrive before React has committed the last batch.
  const feedbackBatchPending = useRef(false);
  const feedbackTransfer = useRef<string | null>(null);
  draftsRef.current = drafts;
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const suggestions = useComposerSuggestions(projectId, trigger);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerBox, setPickerBox] = useState<PickerBox | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const chip = agentChipLabel(selection, agents);
  const labelId = useId();
  const disabled = !!disabledReason || sending || !draftReady;
  const dictation = useDictation();
  // Text around the caret when dictation started; dictated words go between the two.
  const [dictationAnchor, setDictationAnchor] = useState<{ before: string; after: string } | null>(
    null,
  );
  const shownText =
    dictation.active && dictationAnchor
      ? composeDictation({
          ...dictationAnchor,
          finals: dictation.finals,
          interim: dictation.interim,
        }).text
      : text;
  const workflowPrompt =
    workflow?.prompt.trim() ??
    contextItems.find((item) => item.kind === "workflow")?.prompt?.trim() ??
    "";
  const selectedItems: ContextItem[] = [
    ...(workflow
      ? [
          {
            kind: "workflow" as const,
            label: workflow.name,
            detail: workflow.description || workflow.name,
          },
        ]
      : []),
    ...contextItems,
  ];
  const canSend = (!!shownText.trim() || !!workflowPrompt || contextItems.length > 0) && !disabled;

  useEffect(() => {
    if (!dictationAnchor) return;
    const result = composeDictation({ ...dictationAnchor, finals: dictation.finals });
    setText(result.text);
    if (dictation.active) return;
    setDictationAnchor(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    });
  }, [dictationAnchor, dictation.finals, dictation.active]);

  const { active: dictationActive, stop: stopDictation } = dictation;
  useEffect(() => {
    if (disabled && dictationActive) stopDictation();
  }, [disabled, dictationActive, stopDictation]);

  const toggleDictation = () => {
    if (dictation.active) {
      dictation.stop();
      return;
    }
    if (dictation.support?.ok) {
      const el = textareaRef.current;
      const from = el?.selectionStart ?? text.length;
      const to = el?.selectionEnd ?? text.length;
      setDictationAnchor({ before: text.slice(0, from), after: text.slice(to) });
      setTrigger(null);
    }
    void dictation.start();
  };

  useEffect(() => {
    if (!draftStorageKey) return;
    let active = true;
    const warnStorage = () => {
      draftRestoreFailed.current = true;
      if (draftStorageWarning.current) return;
      draftStorageWarning.current = true;
      void warnUser(
        "Draft storage is unavailable. Your current message remains in the composer, but may not survive a reload.",
      );
    };
    void loadFeedbackDraft<{
      text: string;
      files: ReturnType<typeof persistFeedbackFile>[];
      contextItems?: ContextItem[];
    }>(`composer:${draftStorageKey}`)
      .then((saved) => {
        if (!active || !saved) return;
        const restored = saved.files.map(restoreFeedbackFile);
        setText(saved.text);
        if (Array.isArray(saved.contextItems))
          setContextItems(
            saved.contextItems.filter(
              (item) =>
                item &&
                ["workflow", "skill", "file", "folder"].includes(item.kind) &&
                typeof item.label === "string" &&
                typeof item.detail === "string" &&
                (item.prompt === undefined || typeof item.prompt === "string"),
            ),
          );
        setDrafts(
          restored.map((file, index) => ({
            key: draftKey(file, index),
            file,
            ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
          })),
        );
      })
      .catch(warnStorage)
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !draftReady || draftRestoreFailed.current) return;
    const value =
      text || drafts.length || contextItems.length
        ? { text, files: drafts.map(({ file }) => persistFeedbackFile(file)), contextItems }
        : undefined;
    const transfer = feedbackTransfer.current;
    void saveComposerDraft(draftStorageKey, value)
      .then(() => {
        if (transfer && feedbackTransfer.current === transfer) {
          feedbackTransfer.current = null;
        }
      })
      .catch(() => {
        if (transfer && feedbackTransfer.current === transfer) {
          feedbackTransfer.current = null;
          void finishBrowserFeedbackTransfer(transfer, false);
        }
        if (draftStorageWarning.current) return;
        draftStorageWarning.current = true;
        void warnUser(
          "Draft storage is unavailable. Your current message remains in the composer, but may not survive a reload.",
        );
      });
  }, [draftStorageKey, draftReady, text, drafts, contextItems]);

  useEffect(
    () => () => {
      const transfer = feedbackTransfer.current;
      if (transfer) {
        feedbackTransfer.current = null;
        void finishBrowserFeedbackTransfer(transfer, false, true);
      }
    },
    [],
  );

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
    el.style.height = `${Math.max(el.scrollHeight, mode === "new" && !compact ? 72 : 44)}px`;
  }, [text, mode, compact]);

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
      setPickerBox({
        left,
        width,
        bottom: window.innerHeight - rect.top + PICKER_GAP,
        maxHeight: Math.max(80, rect.top - PICKER_GAP - PICKER_EDGE),
      });
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
      let totalBytes = next.reduce(
        (sum, d) => sum + (isBrowserRecording(d.file) ? 0 : d.file.size),
        0,
      );
      for (const [index, file] of incoming.entries()) {
        if (!file.size) continue;
        if (next.length >= MAX_FILES) break;
        const recording = isBrowserRecording(file);
        if (file.size > (recording ? MAX_BROWSER_RECORDING_BYTES : MAX_FILE_BYTES)) {
          oversized.push(file.name);
          continue;
        }
        if (!recording && totalBytes + file.size > MAX_TURN_BYTES) continue;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        next = [
          ...next,
          { key: draftKey(file, index), file, ...(previewUrl ? { previewUrl } : {}) },
        ];
        if (!recording) totalBytes += file.size;
      }
      return next;
    });
    for (const name of oversized) void warnUser(`${name} is larger than 10 MB.`);
  };

  useEffect(() => {
    if (!sessionId || disabled) return;
    const feedbackKey = draftStorageKey ?? sessionId;
    feedbackBatchPending.current = false;
    const consume = () => {
      if (feedbackBatchPending.current) return;
      const incoming = peekBrowserFeedback(feedbackKey);
      if (!incoming.length) return;
      const bytes = draftsRef.current.reduce(
        (total, draft) => total + (isBrowserRecording(draft.file) ? 0 : draft.file.size),
        0,
      );
      const count = feedbackBatchSize(
        incoming,
        draftsRef.current.length,
        bytes,
        {
          files: MAX_FILES,
          fileBytes: MAX_FILE_BYTES,
          turnBytes: MAX_TURN_BYTES,
          recordingBytes: MAX_BROWSER_RECORDING_BYTES,
        },
        isBrowserRecording,
      );
      if (!count) {
        if (!feedbackLimitWarned.current)
          void warnUser(
            "Browser feedback is waiting: make room in the composer for its attachments.",
          );
        feedbackLimitWarned.current = true;
        return;
      }
      feedbackBatchPending.current = true;
      const taken = takeBrowserFeedback(
        feedbackKey,
        count,
        !!draftStorageKey && !draftRestoreFailed.current,
      );
      if (draftStorageKey && !draftRestoreFailed.current && taken.length)
        feedbackTransfer.current = feedbackKey;
      feedbackLimitWarned.current = false;
      addFiles(taken.flatMap((draft) => [...draft.files]));
      setText((previous) =>
        [previous.trimEnd(), ...taken.map((draft) => draft.text)].filter(Boolean).join("\n\n"),
      );
      textareaRef.current?.focus();
    };
    let active = true;
    let queueReady = false;
    const unsubscribe = subscribeBrowserFeedback(() => {
      if (queueReady) consume();
    });
    void ensureBrowserFeedbackLoaded(feedbackKey).then(() => {
      if (!active) return;
      queueReady = true;
      consume();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId, draftStorageKey, disabled, drafts]);

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
    const references = contextItems.filter((item) => item.kind !== "workflow");
    const context = references.length
      ? `Selected context:\n${references.map((item) => (item.kind === "skill" ? `- Use the ${JSON.stringify(item.label)} skill: read and follow ${JSON.stringify(item.detail)}.` : `- Project ${item.kind}: ${JSON.stringify(item.detail)}`)).join("\n")}`
      : "";
    const draftText = shownText;
    const outgoing = [workflowPrompt, draftText.trim(), context].filter(Boolean).join("\n\n");
    if (!outgoing || disabled) return;
    dictation.clearStatus();
    if (dictation.active) {
      setText(draftText);
      setDictationAnchor(null);
      dictation.cancel();
    }
    const files = drafts.map((d) => d.file);
    const presentation = selectedItems.length
      ? {
          text: draftText.trim(),
          references: selectedItems.map(({ kind, label, detail }) => ({ kind, label, detail })),
        }
      : undefined;
    const clear = await onSend(
      outgoing,
      files,
      running ? (delivery ?? "later") : undefined,
      presentation,
    );
    if (clear) {
      setText("");
      setContextItems([]);
      setTrigger(null);
      onWorkflowRemove?.();
      setDrafts((prev) => {
        for (const draft of prev) {
          if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
        }
        return [];
      });
    }
  };

  const updateTrigger = (value: string, caret: number) => {
    setTrigger(composerTrigger(value, caret));
    setActiveSuggestion(0);
  };

  const selectSuggestion = (option: Suggestion) => {
    if (!trigger) return;
    if (option.kind === "workflow") {
      if (onWorkflowSelect) {
        onWorkflowSelect(option.workflow);
      } else {
        setContextItems((previous) => [
          ...previous.filter((item) => item.kind !== "workflow"),
          {
            kind: "workflow",
            label: option.workflow.name,
            detail: option.workflow.description || option.workflow.name,
            prompt: option.workflow.prompt,
          },
        ]);
      }
    } else if (option.kind === "skill") {
      const item: ContextItem = {
        kind: "skill",
        label: option.skill.name,
        detail: `${option.skill.path}/SKILL.md`,
      };
      setContextItems((previous) =>
        previous.some((entry) => entry.kind === item.kind && entry.detail === item.detail)
          ? previous
          : [...previous, item],
      );
    } else {
      const item: ContextItem = {
        kind: option.kind,
        label: option.path.split("/").pop() || option.path,
        detail: option.path,
      };
      setContextItems((previous) =>
        previous.some((entry) => entry.kind === item.kind && entry.detail === item.detail)
          ? previous
          : [...previous, item],
      );
    }
    const replacement = replaceComposerTrigger(text, trigger, "");
    setText(replacement.text);
    setTrigger(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(replacement.caret, replacement.caret);
    });
  };

  const insertTrigger = (symbol: "/" | "@") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const prefix = start > 0 && !/\s/.test(text.charAt(start - 1)) ? " " : "";
    const next = text.slice(0, start) + prefix + symbol + text.slice(end);
    const caret = start + prefix.length + 1;
    setText(next);
    updateTrigger(next, caret);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (trigger && !event.nativeEvent.isComposing) {
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.options.length) {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveSuggestion(
          (previous) =>
            (previous + direction + suggestions.options.length) % suggestions.options.length,
        );
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        suggestions.options.length
      ) {
        event.preventDefault();
        const selected =
          suggestions.options[Math.min(activeSuggestion, suggestions.options.length - 1)];
        if (selected) selectSuggestion(selected);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        return;
      }
    }
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
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !dictation.active) return;
        event.preventDefault();
        dictation.stop();
      }}
    >
      {extra ? <div className="border-b border-line px-4 py-3">{extra}</div> : null}
      {trigger && projectId && (
        <ComposerSuggestions
          {...suggestions}
          kind={trigger.kind}
          active={activeSuggestion}
          onSelect={selectSuggestion}
        />
      )}
      <label htmlFor={labelId} className="sr-only">
        {mode === "new"
          ? workflow
            ? "Add instructions for the selected workflow"
            : "Describe a change"
          : "Follow-up message"}
      </label>
      {selectedItems.length ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <ContextPills
            items={selectedItems}
            disabled={disabled}
            onRemove={(index) => {
              if (workflow && index === 0) onWorkflowRemove?.();
              else
                setContextItems((previous) =>
                  previous.filter((_, itemIndex) => itemIndex !== index - (workflow ? 1 : 0)),
                );
            }}
          />
        </div>
      ) : null}
      <textarea
        id={labelId}
        ref={textareaRef}
        value={shownText}
        readOnly={dictation.active}
        onChange={(e) => {
          setText(e.target.value);
          updateTrigger(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => updateTrigger(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            updateTrigger(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        disabled={!!disabledReason || !draftReady}
        aria-autocomplete="list"
        aria-expanded={!!trigger && !!projectId}
        aria-activedescendant={
          trigger && suggestions.options.length
            ? `composer-suggestion-${Math.min(activeSuggestion, suggestions.options.length - 1)}`
            : undefined
        }
        placeholder={
          disabledReason ??
          (workflow ? "Add instructions for this workflow (optional)" : placeholder)
        }
        rows={mode === "new" ? (compact ? 2 : 3) : 1}
        className={`block w-full resize-none bg-transparent px-4 ${selectedItems.length ? "pt-2" : "pt-3"} pb-2 text-sm leading-5.5 placeholder:text-dim/70 focus-visible:outline-none disabled:opacity-60`}
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
        <p className="px-4 pb-1 text-xs leading-5 text-dim">
          Send later waits until this step finishes. Send now stops this step and uses your message.
        </p>
      ) : null}
      <div ref={footerRef}>
        {pickerOpen &&
          pickerBox &&
          createPortal(
            <div
              ref={pickerWrapRef}
              className="fixed z-50 overflow-y-auto"
              style={{
                left: pickerBox.left,
                bottom: pickerBox.bottom,
                width: pickerBox.width,
                maxHeight: pickerBox.maxHeight,
              }}
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
        <div
          className={`flex flex-wrap items-center gap-2 px-3 pb-3 ${compact ? "@min-[22rem]/composer:flex-nowrap" : ""}`}
        >
          <button
            ref={chipRef}
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            className="btn-quiet flex min-w-0 max-w-[55%] items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/40 aria-expanded:bg-ink/[0.06]"
          >
            <span className="min-w-0 truncate">
              <span className="block truncate text-xs font-medium leading-4">{chip.title}</span>
              <span className="block truncate font-mono text-xs leading-4 text-dim">
                {chip.subtitle}
              </span>
            </span>
          </button>
          {branch ? (
            <span
              className="@max-[22rem]/composer:hidden flex min-w-0 flex-1 basis-0 items-center gap-1.5 font-mono text-xs text-dim"
              title={`Branch ${branch}`}
            >
              <GitBranch className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className="truncate">{branch}</span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-0.5">
              {projectId && (
                <>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => insertTrigger("/")}
                    className={toolButtonClass}
                    aria-label="Insert workflow or skill"
                    title="Insert workflow or skill"
                  >
                    <span className="font-mono text-base leading-none" aria-hidden>
                      /
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => insertTrigger("@")}
                    className={toolButtonClass}
                    aria-label="Reference a project file or folder"
                    title="Reference a project file or folder"
                  >
                    <AtSign className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </>
              )}
              <ComposerAttachButton
                disabled={disabled}
                atLimit={drafts.length >= MAX_FILES}
                fileInputRef={fileInputRef}
                className={toolButtonClass}
              />
              <DictationControl
                dictation={dictation}
                disabled={disabled}
                buttonClass={toolButtonClass}
                onToggle={toggleDictation}
              />
            </div>
            {running ? (
              <>
                <button
                  type="button"
                  onClick={() => void send("later")}
                  disabled={!canSend}
                  className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  Send later
                </button>
                <button
                  type="button"
                  onClick={() => void send("now")}
                  disabled={!canSend}
                  className="btn-amber px-3 py-1.5 text-xs disabled:opacity-60"
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
                <ArrowUp className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      {dictation.status ? (
        <p
          role={dictation.status.kind === "error" ? "alert" : "status"}
          className={`border-t border-line px-4 py-2 text-xs leading-5 ${dictation.status.kind === "error" ? "text-danger" : "text-dim"}`}
        >
          {dictation.status.message}
        </p>
      ) : dictation.active ? (
        <p role="status" className="border-t border-line px-4 py-2 text-xs leading-5 text-dim">
          {dictation.phase === "starting"
            ? "Starting dictation…"
            : dictation.phase === "stopping"
              ? "Finishing dictation…"
              : dictation.activeMicLabel
                ? `Listening on ${dictation.activeMicLabel}`
                : "Listening"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-t border-line px-4 py-2 text-xs leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
