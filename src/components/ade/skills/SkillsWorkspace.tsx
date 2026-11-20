import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Upload } from "lucide-react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { skillsQuery } from "@/lib/ade/queries";
import { saveSkill, type Skill } from "@/lib/ade/skillsApi";
import { SkillCard } from "@/components/ade/skills/SkillCard";
import { SkillDrawer, type SkillDrawerView } from "@/components/ade/skills/SkillDrawer";
import { SkillImportDialog } from "@/components/ade/skills/SkillImportDialog";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "ade-project", label: "This project" },
  { value: "ade-user", label: "My ADE" },
  { value: "detected", label: "Found" },
];

/**
 * The Skills workspace: a gallery of every skill the agents here can load, and
 * a drawer for one skill's details, its files, and the frontmatter that names it.
 */
export function SkillsWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(skillsQuery(projectId));
  const [filter, setFilter] = useState("all");
  const [queryText, setQueryText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<SkillDrawerView>("details");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");

  const skills = useMemo(() => query.data ?? [], [query.data]);
  const selected = skills.find((skill) => skill.id === selectedId) ?? null;

  const shown = useMemo(() => {
    const term = queryText.trim().toLowerCase();
    return skills.filter((skill) => {
      if (filter === "detected" && skill.scope !== "detected") return false;
      if (filter !== "all" && filter !== "detected" && skill.rootId !== filter) return false;
      if (!term) return true;
      return (
        skill.name.toLowerCase().includes(term) || skill.description.toLowerCase().includes(term)
      );
    });
  }, [skills, filter, queryText]);

  const create = useMutation({
    mutationFn: () => {
      const taken = new Set(skills.map((skill) => skill.name));
      let name = "new-skill";
      let suffix = 2;
      while (taken.has(name)) name = `new-skill-${suffix++}`;
      return saveSkill(projectId, {
        rootId: "ade-project",
        name,
        description: "Use this skill when …",
        body: "## Steps\n\n1. ",
      });
    },
    // The new folder only becomes a card once the list is refetched, so the
    // drawer can open on a skill the gallery already knows about.
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
      setSelectedId(skill.id);
      setView("edit");
      setOpenFile(null);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const openSkill = (skill: Skill) => {
    setSelectedId(skill.id);
    setView("details");
    setOpenFile(null);
  };

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 @lg/workflows:px-7 @lg/workflows:py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="heading-display text-2xl @lg/workflows:text-3xl">Skills</h1>
              <p className="mt-3 max-w-[62ch] text-ui text-dim">
                Instructions an agent loads on demand. ADE keeps its own skills in{" "}
                <code className="font-mono text-(length:--text-xs)">.ade/skills</code>, so nothing
                depends on another client&apos;s folders. Import a <code>.skill</code> package or a
                zip of skills, or write one here.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn-quiet inline-flex items-center gap-1.5 px-3 py-2 text-ui"
                onClick={() => setImporting(true)}
              >
                <Upload className="size-3.5" aria-hidden />
                Import
              </button>
              <button
                type="button"
                className="btn-amber inline-flex items-center gap-1.5 px-3 py-2 text-ui"
                onClick={() => create.mutate()}
                disabled={create.isPending}
              >
                <Plus className="size-3.5" aria-hidden />
                {create.isPending ? "Creating…" : "New skill"}
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Skill filters"
              value={filter}
              onValueChange={setFilter}
              options={FILTERS}
            />
            <div className="relative min-w-40 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim"
                aria-hidden
              />
              <input
                type="search"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="Search skills"
                aria-label="Search skills"
                className="w-full rounded-lg border border-line bg-paper py-2 pr-3 pl-9 text-ui text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
              />
            </div>
          </div>

          {query.isPending ? (
            <TextShimmer as="p" className="mt-8 text-ui text-dim">
              Loading skills…
            </TextShimmer>
          ) : shown.length ? (
            <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {shown.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  selected={skill.id === selectedId}
                  onSelect={openSkill}
                />
              ))}
            </div>
          ) : (
            <p className="mt-8 text-ui text-dim">
              {skills.length === 0
                ? "No skills yet. Import a package, or write one here."
                : "No skills match this search."}
            </p>
          )}
        </div>
      </div>

      {selected ? (
        <div key="skill-drawer" className="absolute inset-y-0 right-0 z-10 w-full">
          <SkillDrawer
            projectId={projectId}
            skill={selected}
            view={view}
            openFile={openFile}
            onClose={() => setSelectedId(null)}
            onView={setView}
            onOpenFile={(path) => {
              setOpenFile(path);
              setView("files");
            }}
            onRemoved={() => {
              setSelectedId(null);
              setNotice("Skill removed");
            }}
            onTransferred={(moved, mode) => {
              setSelectedId(moved.id);
              setView("details");
              setNotice(
                `${mode === "move" ? "Moved" : "Copied"} “${moved.name}” to ${moved.location}`,
              );
            }}
          />
        </div>
      ) : null}

      {importing ? (
        <SkillImportDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onImported={(imported) => {
            setImporting(false);
            setNotice(
              `Imported ${imported.length} skill${imported.length === 1 ? "" : "s"} into ${
                imported[0]?.location.split("/").slice(0, 2).join("/") ?? "ADE"
              }`,
            );
          }}
        />
      ) : null}

      {notice ? (
        <div
          role="status"
          className="pointer-events-none absolute right-4 bottom-4 z-30 rounded-lg border border-line bg-panel px-3 py-2 text-ui shadow-lg"
        >
          {notice}
        </div>
      ) : null}
    </main>
  );
}
