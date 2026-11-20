import { createContext, useContext } from "react";

/** Below `lg` the workbench shows one pane at a time; the layout's tabs pick it. */
export type CustomizePane = "changes" | "conversation" | "details";

export const CustomizePaneContext = createContext<{
  pane: CustomizePane;
  setPane: (pane: CustomizePane) => void;
}>({ pane: "conversation", setPane: () => {} });

export function useCustomizePane() {
  return useContext(CustomizePaneContext);
}

/** Classes that show a pane on phones only when its tab is selected; always shown from `lg`. */
export function paneVisibility(active: boolean) {
  return active ? "flex" : "hidden lg:flex";
}
