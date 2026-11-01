import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { askConfirm, warnUser } from "@/components/ade/NoticeDialog";
import { useAde, useAdeState } from "@/lib/ade/store";

export function ProjectsMenu({
  showActiveName = false,
}: {
  /** Mobile: show the active project name on the trigger. */
  showActiveName?: boolean;
}) {
  const { selectProject, removeProject } = useAde();
  const { projects, activeProjectId } = useAdeState((state) => ({
    projects: state.projects,
    activeProjectId: state.activeProjectId,
  }));
  const navigate = useNavigate();
  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  const removeActive = async () => {
    if (!active) return;
    const confirmed = await askConfirm({
      title: `Remove ${active.name} from ADE?`,
      description: `This deletes only ADE's metadata (sessions, process entries) for it — the folder ${active.path} and every file in it are untouched.`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    try {
      await removeProject(active.id);
      const next = projects.find((p) => p.id !== active.id);
      if (next) {
        selectProject(next.id);
        void navigate({
          to: "/p/$projectId/conversations",
          params: { projectId: next.id },
        });
      } else {
        void navigate({ to: "/" });
      }
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          showActiveName
            ? "inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-amber"
            : "inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md px-2 text-[13px] text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        }
        aria-label="Projects menu"
      >
        <span className="min-w-0 truncate">
          {showActiveName ? (active?.name ?? "Projects") : "Projects"}
        </span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16rem] border-line bg-panel">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
            onSelect={() => {
              selectProject(p.id);
              void navigate({
                to: "/p/$projectId/conversations",
                params: { projectId: p.id },
              });
            }}
          >
            <span className="text-[13px] font-medium text-ink">{p.name}</span>
            <span className="max-w-[18rem] break-all font-mono text-[10px] text-dim">
              {p.path}
              {p.missing ? " · missing" : ""}
            </span>
          </DropdownMenuItem>
        ))}
        {projects.length === 0 && (
          <DropdownMenuItem asChild>
            <Link to="/projects/add" className="cursor-pointer text-[13px]">
              + Add project
            </Link>
          </DropdownMenuItem>
        )}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-[12px] text-danger focus:text-danger"
              onSelect={() => {
                window.setTimeout(() => void removeActive(), 0);
              }}
            >
              Remove {active.name}…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
