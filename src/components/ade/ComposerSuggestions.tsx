import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { File, Folder, Sparkles, Workflow as WorkflowIcon } from "lucide-react";
import { listEditorEntries, searchEditorFiles } from "@/lib/ade/editorApi";
import { skillsQuery, workflowsQuery } from "@/lib/ade/queries";
import type { Skill } from "@/lib/ade/skillsApi";
import type { Workflow } from "@/lib/ade/types";
import type { ComposerTrigger } from "./composerSuggestions.mjs";

export type Suggestion =
  | { kind: "workflow"; workflow: Workflow }
  | { kind: "skill"; skill: Skill }
  | { kind: "file" | "folder"; path: string };

export function useComposerSuggestions(
  projectId: string | undefined,
  trigger: ComposerTrigger | null,
) {
  const command = trigger?.kind === "command";
  const reference = trigger?.kind === "reference";
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(trigger?.query ?? ""), 150);
    return () => clearTimeout(timer);
  }, [trigger?.query]);
  const workflows = useQuery({ ...workflowsQuery(), enabled: !!projectId && command });
  const skills = useQuery({ ...skillsQuery(projectId ?? ""), enabled: !!projectId && command });
  const entries = useQuery({
    queryKey: ["composer-references", projectId, search],
    queryFn: async () =>
      search
        ? (await searchEditorFiles(projectId!, search, true)).entries
        : (await listEditorEntries(projectId!)).entries,
    enabled: !!projectId && reference && search === trigger?.query && search.length <= 120,
    staleTime: 5000,
  });
  const needle = (trigger?.query ?? "").toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(needle);
  const options: Suggestion[] = command
    ? [
        ...(workflows.data ?? [])
          .filter((w) => matches(`${w.name} ${w.description}`))
          .map((workflow): Suggestion => ({ kind: "workflow", workflow })),
        ...(skills.data ?? [])
          .filter((s) => matches(`${s.name} ${s.description}`))
          .map((skill): Suggestion => ({ kind: "skill", skill })),
      ].slice(0, 30)
    : reference && search === trigger?.query
      ? (entries.data ?? [])
          .slice(0, 30)
          .map((entry): Suggestion => ({ kind: entry.kind, path: entry.path }))
      : [];
  return {
    options,
    loading: command
      ? workflows.isFetching || skills.isFetching
      : search !== trigger?.query || entries.isFetching,
    error: command ? workflows.isError || skills.isError : entries.isError,
  };
}

export function ComposerSuggestions({
  options,
  active,
  loading,
  error,
  kind,
  onSelect,
}: {
  options: Suggestion[];
  active: number;
  loading: boolean;
  error: boolean;
  kind: ComposerTrigger["kind"];
  onSelect: (option: Suggestion) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 z-40 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface-raised p-1 shadow-xl"
      role="listbox"
      aria-label={kind === "command" ? "Workflows and skills" : "Project files and folders"}
    >
      <p className="px-3 py-2 text-xs text-dim">
        {kind === "command" ? "Workflows and skills" : "Project files and folders"}
      </p>
      {options.map((option, index) => {
        const label =
          option.kind === "workflow"
            ? option.workflow.name
            : option.kind === "skill"
              ? option.skill.name
              : option.path;
        const detail =
          option.kind === "workflow"
            ? option.workflow.description
            : option.kind === "skill"
              ? `${option.skill.description} · ${option.skill.location}`
              : option.kind;
        const Icon =
          option.kind === "workflow"
            ? WorkflowIcon
            : option.kind === "skill"
              ? Sparkles
              : option.kind === "folder"
                ? Folder
                : File;
        const key =
          option.kind === "workflow"
            ? `workflow:${option.workflow.id}`
            : option.kind === "skill"
              ? `skill:${option.skill.id}:${option.skill.path}`
              : `${option.kind}:${option.path}`;
        return (
          <button
            key={key}
            id={`composer-suggestion-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option)}
            className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/[0.06] ${index === active ? "bg-ink/[0.06]" : ""}`}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-dim" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{label}</span>
              <span className="block truncate text-xs text-dim">
                {option.kind === "workflow"
                  ? "Workflow · "
                  : option.kind === "skill"
                    ? "Skill · "
                    : ""}
                {detail}
              </span>
            </span>
          </button>
        );
      })}
      {loading && <p className="px-3 py-2 text-xs text-dim">Searching…</p>}
      {error && (
        <p className="px-3 py-2 text-xs text-danger">Some suggestions could not be loaded.</p>
      )}
      {!loading && !error && !options.length && (
        <p className="px-3 py-2 text-xs text-dim">No matches found.</p>
      )}
    </div>
  );
}
