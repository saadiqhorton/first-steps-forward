import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRightPaneHost } from "./rightPaneContext";

/**
 * Portals `children` into the Shell's right column.
 *
 * The Shell owns an empty host element inside its resizable right Panel; this
 * component renders right-pane content (e.g. `<AgentComputerPane/>`) into it. Using a
 * portal keeps the route's content fresh on every render without storing a
 * ReactNode in state (which would re-render forever).
 *
 * Renders nothing until the host mounts, and on narrow layouts where the
 * desktop Shell — and therefore the right column — is not rendered.
 */
export function RightPanePortal({ children }: { children: ReactNode }) {
  const host = useRightPaneHost();
  if (!host) return null;
  return createPortal(children, host);
}
