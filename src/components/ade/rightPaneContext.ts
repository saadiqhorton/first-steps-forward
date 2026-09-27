import { createContext, useContext } from "react";

/**
 * Context carrying the Shell's right-column host element.
 *
 * Kept in a plain `.ts` module (hooks/constants only, no component export) so
 * fast refresh lint stays quiet.
 */
export const RightPaneHostContext = createContext<HTMLElement | null>(null);

export function useRightPaneHost(): HTMLElement | null {
  return useContext(RightPaneHostContext);
}
