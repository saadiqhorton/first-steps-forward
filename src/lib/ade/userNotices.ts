/** Confirm / alert queue for NoticeDialogHost. No React UI — lib-safe for store and browser helpers. */

export type ConfirmRequest = {
  kind: "confirm";
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: boolean) => void;
};

export type AlertRequest = {
  kind: "alert";
  title: string;
  description: string;
  resolve: () => void;
};

export type NoticeRequest = ConfirmRequest | AlertRequest;

let enqueue: ((request: NoticeRequest) => void) | null = null;

/** Bound by NoticeDialogHost while mounted; pass null on unmount. */
export function bindNoticeEnqueue(handler: ((request: NoticeRequest) => void) | null) {
  enqueue = handler;
}

export function settleNotice(request: NoticeRequest, confirmed: boolean) {
  if (request.kind === "confirm") request.resolve(confirmed);
  else request.resolve();
}

/** Design-system confirmation. Resolves false when the host is not mounted. */
export function askConfirm(options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  if (!enqueue) return Promise.resolve(false);
  return new Promise((resolve) => {
    enqueue!({
      kind: "confirm",
      title: options.title,
      description: options.description ?? "",
      confirmLabel: options.confirmLabel ?? "Continue",
      cancelLabel: options.cancelLabel ?? "Cancel",
      resolve,
    });
  });
}

/** Design-system warning. The message is the dialog body. */
export function warnUser(message: string, title = "Something went wrong"): Promise<void> {
  if (!enqueue) return Promise.resolve();
  return new Promise((resolve) => {
    enqueue!({ kind: "alert", title, description: message, resolve });
  });
}
