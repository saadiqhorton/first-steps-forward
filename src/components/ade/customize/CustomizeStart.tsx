import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Play } from "lucide-react";
import { Composer } from "@/components/ade/Composer";
import { SignInDialog } from "@/components/ade/SignInDialog";
import { saveComposerDraft } from "@/lib/ade/browser/composerFeedback";
import {
  changeInProgress,
  createChange,
  useCustomizeAction,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import type { Agent } from "@/lib/ade/types";
import { KeptList } from "./KeptList";
import { UpdateNotice } from "./UpdateNotice";
import { useAgentSelection } from "./useAgentSelection";

const IDEAS = [
  {
    title: "Copy a session's full log",
    description:
      "Add a button to the session header that copies everything, not just what's on screen.",
    prompt: "Add a button to the session header that copies the session's full log.",
  },
  {
    title: "Stop idle dev servers",
    description: "Shut down dev servers nobody has used for an hour, and say so in Processes.",
    prompt:
      "Stop dev servers that nobody has used for an hour, and show that they were stopped in Processes.",
  },
  {
    title: "Add a keyboard shortcut",
    description: "Jump to Inbox from anywhere with a key combination.",
    descriptionClass: "max-w-64",
    prompt: "Add a keyboard shortcut that opens Inbox from anywhere in ADE.",
  },
];

/** The new-change draft survives reloads, refetches and the update notice coming and going. */
const DRAFT_KEY = "customize:new";

export function CustomizeStart({ state }: { state: CustomizeState }) {
  const navigate = useNavigate();
  const { selection, setSelection, agent, unusableReason } = useAgentSelection();
  const [criteria, setCriteria] = useState("");
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [seed, setSeed] = useState({ text: "", nonce: 0 });
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<Agent | null>(null);
  const create = useCustomizeAction(createChange);
  const current = changeInProgress(state);

  const onSend = async (text: string) => {
    if (unusableReason) {
      setError(unusableReason);
      return false;
    }
    if (text.trim().length <= 3) {
      setError("Describe the change in a bit more detail.");
      return false;
    }
    setError(null);
    try {
      const { change } = await create.mutateAsync({
        request: text.trim(),
        agentId: selection.agentId,
        ...(criteria.trim() ? { criteria: criteria.trim() } : {}),
        ...(selection.model.trim() ? { model: selection.model.trim() } : {}),
        ...(selection.effort.trim() ? { effort: selection.effort.trim() } : {}),
      });
      void navigate({ to: "/workspace/customize/$changeId", params: { changeId: change.id } });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  // The composer restores its saved draft when it mounts, so an idea is saved as the draft first.
  const seedIdea = async (text: string) => {
    await saveComposerDraft(DRAFT_KEY, { text, files: [], contextItems: [] }).catch(() => {});
    setSeed((prev) => ({ text, nonce: prev.nonce + 1 }));
  };

  const extra = (
    <div>
      <button
        type="button"
        onClick={() => setCriteriaOpen((v) => !v)}
        className="label-section inline-flex items-center gap-1 transition-colors hover:text-ink"
        aria-expanded={criteriaOpen}
      >
        Acceptance criteria (optional)
        <ChevronDown
          className={`size-4 transition-transform motion-reduce:transition-none ${criteriaOpen ? "rotate-180" : ""}`}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>
      {criteriaOpen && (
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={2}
          placeholder="How will you know it works? Leave blank to let the agent decide."
          className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-ui leading-relaxed placeholder:text-dim/70"
        />
      )}
      {agent?.installed && !agent.signedIn && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-line bg-surface-muted px-4 py-3 text-ui leading-5">
          <span>
            {agent.id === "opencode"
              ? "OpenCode has no provider sign-in detected. Some models may work without one."
              : `${agent.name} is installed but not signed in.`}
          </span>
          <button
            type="button"
            onClick={() => setSigning(agent)}
            className="btn-amber ml-auto px-3 py-1.5 text-xs"
          >
            Set up
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex w-full max-w-3xl flex-col px-4 pt-12 pb-8 @lg:px-7 @lg:py-10">
      {state.update && (
        <div className="mb-8 empty:hidden">
          <UpdateNotice state={state} />
        </div>
      )}
      <h1 className="heading-display text-2xl @lg:text-3xl">What should ADE do differently?</h1>
      <p className="mt-2 text-ui text-dim @lg:mt-3">
        Describe a change and an agent builds it in your own copy of ADE
      </p>

      <div className="mt-9 @lg:mt-8">
        <div className="label-section">Start with an idea</div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 @lg:mt-3 @lg:gap-3">
          {IDEAS.map((idea) => (
            <button
              key={idea.title}
              type="button"
              disabled={!!current}
              onClick={() => void seedIdea(idea.prompt)}
              className="card-panel group flex flex-col items-start gap-2 p-4 text-left transition hover:border-ink/25 disabled:opacity-60"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0 text-sm font-medium leading-snug">{idea.title}</span>
                <Play
                  className="mt-0.5 size-4 shrink-0 text-dim transition group-hover:text-ink"
                  aria-hidden
                />
              </div>
              <p
                className={`line-clamp-2 text-xs leading-relaxed text-dim ${idea.descriptionClass ?? ""}`}
              >
                {idea.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {current && (
        <Link
          to="/workspace/customize/$changeId"
          params={{ changeId: current.id }}
          className="mt-6 inline-flex items-center gap-1.5 self-start text-ui text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          Go to “{current.title}”
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
      )}

      <div className="mt-3 @lg:mt-6">
        <Composer
          key={seed.nonce}
          mode="new"
          compact
          projectId="ade-self"
          selection={selection}
          onSelectionChange={setSelection}
          branch=""
          placeholder="Describe a change"
          initialText={seed.text}
          draftStorageKey={DRAFT_KEY}
          sending={create.isPending}
          error={error}
          onSend={onSend}
          extra={extra}
          {...(current ? { disabledReason: "Finish or undo the current change first" } : {})}
        />
      </div>

      <div className="mt-10">
        <KeptList state={state} />
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </div>
  );
}
