import type { Message } from "@/lib/ade/types";

export type ThreadItem =
  | { kind: "message"; message: Message }
  | { kind: "fix"; message: Message }
  | { kind: "same"; message: Message }
  | { kind: "resolved"; id: string; messages: Message[]; attempts: number };

export function threadItems(
  messages: Message[],
  isFix: (message: Message) => boolean,
  resolved: boolean,
): ThreadItem[];
