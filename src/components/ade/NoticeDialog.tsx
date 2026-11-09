import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  bindNoticeEnqueue,
  settleNotice,
  type NoticeRequest,
} from "@/lib/ade/userNotices";

/**
 * One alert-dialog host for confirms and warnings.
 * Visual treatment matches the sign-in and harness dialogs: raised surface, amber action, quiet cancel.
 */
export function NoticeDialogHost() {
  const queue = useRef<NoticeRequest[]>([]);
  const currentRef = useRef<NoticeRequest | null>(null);
  const [current, setCurrent] = useState<NoticeRequest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    bindNoticeEnqueue((request) => {
      if (currentRef.current) queue.current.push(request);
      else {
        currentRef.current = request;
        setCurrent(request);
        setOpen(true);
      }
    });
    return () => {
      bindNoticeEnqueue(null);
      const pending = [currentRef.current, ...queue.current].filter(
        (item): item is NoticeRequest => item !== null,
      );
      currentRef.current = null;
      queue.current = [];
      for (const item of pending) settleNotice(item, false);
    };
  }, []);

  const finish = (confirmed: boolean) => {
    const item = currentRef.current;
    if (!item) return;
    currentRef.current = null;
    settleNotice(item, confirmed);
    const next = queue.current.shift() ?? null;
    if (next) {
      currentRef.current = next;
      setCurrent(next);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-lg gap-0 rounded-2xl border bg-surface-raised p-6 text-ink shadow-lg sm:rounded-2xl">
        <AlertDialogTitle className="text-xl font-medium">{current?.title ?? ""}</AlertDialogTitle>
        {current?.description ? (
          <AlertDialogDescription className="mt-3 text-[13px] leading-relaxed text-dim">
            {current.description}
          </AlertDialogDescription>
        ) : null}
        <div className="mt-5 flex gap-2">
          {current?.kind === "confirm" ? (
            <button
              type="button"
              className="btn-amber px-4 py-2 text-[13px]"
              onClick={() => finish(true)}
            >
              {current.confirmLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-quiet ml-auto px-4 py-2 text-[13px]"
            onClick={() => finish(false)}
          >
            {current?.kind === "confirm" ? current.cancelLabel : "OK"}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
