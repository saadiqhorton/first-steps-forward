import { Outlet, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { RightTab } from "@/lib/ade/navigation";

const rightTabs = [
  "activity",
  "preview",
  "editor",
  "terminal",
] as const satisfies readonly RightTab[];

const conversationsSearchSchema = z.object({
  completed: z.boolean().optional(),
  pane: z.enum(rightTabs).optional(),
  dialog: z.enum(["agents", "add-project"]).optional(),
});

export type ConversationsSearch = z.infer<typeof conversationsSearchSchema>;

export const Route = createFileRoute("/p/$projectId/conversations")({
  validateSearch: (search: Record<string, unknown>): ConversationsSearch => {
    const completedRaw = search["completed"];
    const completed =
      completedRaw === true || completedRaw === "true"
        ? true
        : completedRaw === false || completedRaw === "false"
          ? false
          : undefined;
    const parsed = conversationsSearchSchema.safeParse({
      completed,
      pane: search["pane"],
      dialog: search["dialog"],
    });
    return parsed.success ? parsed.data : {};
  },
  component: ConversationsLayout,
});

function ConversationsLayout() {
  return <Outlet />;
}
