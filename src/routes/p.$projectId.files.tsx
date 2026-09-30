import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/files")({
  head: () => ({ meta: [{ title: "Files — ADE" }] }),
  component: FilesPlaceholder,
});

function FilesPlaceholder() {
  return (
    <main className="grid flex-1 place-items-center px-8 text-center">
      <p className="text-[14px] text-dim">Files are coming in the next stage.</p>
    </main>
  );
}
