import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workspace")({
  component: WorkspaceLayout,
  head: () => ({
    meta: [
      { title: "ADE — Workspace" },
      {
        name: "description",
        content:
          "Your projects, decisions, running agents and assistant chats in one local workspace.",
      },
    ],
  }),
});

/** Every workspace page shares the global shell; this route only hosts the child page. */
function WorkspaceLayout() {
  return <Outlet />;
}
