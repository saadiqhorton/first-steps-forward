import { useId } from "react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import {
  SCOPE_ERROR,
  scopeInvalid,
  SEGMENTS,
  type ScopeMode,
  type ScopeValue,
} from "./connectorText";

const MODES = [
  { value: "luna", label: "Luna" },
  { value: "projects", label: "Projects" },
  { value: "both", label: "Both" },
];

const HINTS: Record<ScopeMode, string> = {
  luna: "Only Luna, your workspace assistant, can call it.",
  projects: "Only agents in the projects you pick can call it.",
  both: "Luna and agents in your projects can call it.",
};

/** "Available in": Luna, projects, or both; projects can be all of them or chosen ones. */
export function ScopePicker({
  value,
  onChange,
  projects,
}: {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  projects: { id: string; name: string }[];
}) {
  const id = useId();
  const invalid = scopeInvalid(value);
  const toggle = (projectId: string, checked: boolean) =>
    onChange({
      ...value,
      selected: checked
        ? [...value.selected.filter((existing) => existing !== projectId), projectId]
        : value.selected.filter((existing) => existing !== projectId),
    });
  return (
    <div className="grid gap-2">
      <div className="label-mono" id={`${id}-label`}>
        Available in
      </div>
      <SegmentedControl
        label="Available in"
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode: mode as ScopeMode })}
        options={MODES}
        className={SEGMENTS}
      />
      <p className="text-xs leading-normal text-(--text-secondary)">{HINTS[value.mode]}</p>
      {value.mode !== "luna" && (
        <fieldset className="mt-1 grid gap-2 rounded-md border border-line bg-panel p-3">
          <legend className="sr-only">Which projects</legend>
          <label className="flex cursor-pointer items-center gap-2 text-ui leading-normal">
            <input
              type="radio"
              name={`${id}-pick`}
              checked={value.pick === "all"}
              onChange={() => onChange({ ...value, pick: "all" })}
              className="size-3.5 shrink-0 accent-amber-deep"
            />
            All projects, including ones you add later
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-ui leading-normal">
            <input
              type="radio"
              name={`${id}-pick`}
              checked={value.pick === "some"}
              onChange={() => onChange({ ...value, pick: "some" })}
              className="size-3.5 shrink-0 accent-amber-deep"
            />
            Only these
          </label>
          <div
            className={`grid gap-1.5 pl-6 ${value.pick === "all" ? "pointer-events-none opacity-(--opacity-disabled)" : ""}`}
            aria-disabled={value.pick === "all" || undefined}
          >
            {projects.length === 0 && (
              <p className="text-xs text-dim">No projects yet. Add one from the top bar.</p>
            )}
            {projects.map((project) => (
              <label
                key={project.id}
                className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs leading-normal text-(--text-secondary)"
              >
                <input
                  type="checkbox"
                  tabIndex={value.pick === "all" ? -1 : undefined}
                  checked={value.pick === "all" || value.selected.includes(project.id)}
                  onChange={(event) => toggle(project.id, event.target.checked)}
                  className="size-3.5 shrink-0 accent-amber-deep"
                />
                <span className="min-w-0 truncate">{project.name}</span>
              </label>
            ))}
          </div>
          {invalid && (
            <p role="alert" className="pl-6 text-xs text-danger">
              {SCOPE_ERROR}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
