import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/p/$projectId/conversations",
      params: { projectId: params.projectId },
      replace: true,
    });
  },
});
