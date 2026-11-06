import { createContext, useContext } from "react";
import type { RightTab } from "@/lib/ade/navigation";

export type ShellDialog = "agents" | "add-project";

export type ShellContextValue = {
  rightTab: RightTab;
  selectTab: (t: RightTab) => void;
  openDialog: (d: ShellDialog) => void;
  /** Calls the handler registered below; no-op when none. */
  toggleList: () => void;
  /** Section routes register their left-column collapse/expand. */
  registerListToggle: (fn: (() => void) | null) => void;
};

/**
 * Shell chrome context (right-pane tab, dialogs, list toggle).
 *
 * Kept in a plain `.ts` module (hooks/constants only, no component export) so
 * fast refresh lint stays quiet.
 */
export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used within Shell");
  return value;
}
