export type ComposerTrigger = {
  kind: "command" | "reference";
  query: string;
  start: number;
  end: number;
};
export function composerTrigger(text: string, caret: number): ComposerTrigger | null;
export function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  value: string,
): { text: string; caret: number };
