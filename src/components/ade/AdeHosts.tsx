import { type ReactNode } from "react";
import { NoticeDialogHost } from "@/components/ade/NoticeDialog";
import { TokenGate } from "@/components/ade/TokenGate";
import { useAde, useAdeState } from "@/lib/ade/store";

/** Shows TokenGate when the local service requires auth; otherwise renders children. */
export function AdeGate({ children }: { children: ReactNode }) {
  const authRequired = useAdeState((state) => state.authRequired);
  const { refresh } = useAde();
  if (authRequired) return <TokenGate onUnlocked={() => refresh()} />;
  return children;
}

/** Auth gate + notice dialogs; mount inside AdeProvider. */
export function AdeHosts({ children }: { children: ReactNode }) {
  return (
    <>
      <AdeGate>{children}</AdeGate>
      <NoticeDialogHost />
    </>
  );
}
