import { createFileRoute } from "@tanstack/react-router";
import { ConnectorsWorkspace } from "@/components/ade/connectors/ConnectorsWorkspace";

export const Route = createFileRoute("/workspace/connectors")({
  component: ConnectorsWorkspace,
  head: () => ({ meta: [{ title: "Connectors — ADE" }] }),
});
