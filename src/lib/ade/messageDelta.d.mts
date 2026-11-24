export type MessageDelta = {
  parentId: string;
  offset: number;
  append: string;
  message: { id: string; role: string; at: number };
};
export function applyMessageDelta<M extends { id: string; text: string }>(
  messages: M[],
  delta: Pick<MessageDelta, "offset" | "append" | "message">,
): M[] | null;
