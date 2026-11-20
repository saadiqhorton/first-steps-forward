import { useEffect } from "react";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useAdeState } from "@/lib/ade/store";

export const Route = createFileRoute("/sessions/$sessionId")({
  head: () => ({ meta: [{ title: "Work session — ADE" }] }),
  component: SessionRedirect,
  notFoundComponent: () => (
    <main className="grid flex-1 place-items-center">
      <div className="text-center">
        <h1 className="text-xl font-medium">Session not found</h1>
        <Link to="/" className="btn-quiet mt-3 inline-block px-3 py-1.5 text-(length:--text-xs)">
          Back home
        </Link>
      </div>
    </main>
  ),
});

function SessionRedirect() {
  const { sessionId } = Route.useParams();
  const state = useAdeState((state) => ({ hydrated: state.hydrated, sessions: state.sessions }));
  const navigate = useNavigate();
  const session = state.sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (!state.hydrated || !session) return;
    void navigate({
      to: "/p/$projectId/conversations/$sessionId",
      params: { projectId: session.projectId, sessionId: session.id },
      replace: true,
    });
  }, [state.hydrated, session, navigate]);

  if (!state.hydrated) return <main className="flex-1" />;
  if (!session) throw notFound();
  return <main className="flex-1" />;
}
