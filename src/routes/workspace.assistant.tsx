import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/workspace/assistant")({
  component: AssistantLayout,
});

/** `/workspace/assistant/<threadId>` renders under this layout. */
function AssistantLayout() {
  return <Outlet />;
}
