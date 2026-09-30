import { useEffect } from "react";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { SessionView } from "@/components/ade/SessionView";
import { useAde } from "@/lib/ade/store";
import { markViewed } from "@/lib/ade/viewed";

export const Route = createFileRoute("/p/$projectId/conversations/$sessionId")({
  head: () => ({ meta: [{ title: "Work session — ADE" }] }),
  component: ProjectSessionPage,
  notFoundComponent: () => (
    <main className="grid flex-1 place-items-center">
      <div className="text-center">
        <div className="font-display text-3xl">Session not found</div>
        <Link to="/" className="btn-quiet mt-3 inline-block px-3 py-1.5 text-[12px]">
          Back home
        </Link>
      </div>
    </main>
  ),
});

function ProjectSessionPage() {
  const { projectId, sessionId } = Route.useParams();
  const { state } = useAde();
  const navigate = useNavigate();
  const session = state.sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (!state.hydrated || !session) return;
    if (session.projectId === projectId) return;
    void navigate({
      to: "/p/$projectId/conversations/$sessionId",
      params: { projectId: session.projectId, sessionId },
      replace: true,
    });
  }, [state.hydrated, session, projectId, sessionId, navigate]);

  const viewedSessionId = session?.id;
  const viewedUpdatedAt = session?.updatedAt;
  useEffect(() => {
    if (viewedSessionId == null || viewedUpdatedAt == null) return;
    markViewed(viewedSessionId, viewedUpdatedAt);
  }, [viewedSessionId, viewedUpdatedAt]);

  if (state.hydrated && !session) throw notFound();
  if (session && session.projectId !== projectId) return <main className="flex-1" />;

  return <SessionView sessionId={sessionId} />;
}
