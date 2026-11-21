import { format } from "date-fns";
import { runningWithoutChanges, type Change, type CustomizeState } from "@/lib/ade/customizeApi";
import { timeAgo } from "@/lib/ade/store";

export function changeDate(now: number, iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return now - at < 24 * 60 * 60 * 1000 ? timeAgo(now, at) : format(at, "MMM d");
}

const agentsWord = (n: number) => `${n} agent${n === 1 ? "" : "s"}`;

/** Where kept changes stand: waiting for a restart, switching, or the switch failed. */
export function switchNote(state: CustomizeState): string | null {
  const s = state.switch;
  if (s.status === "pending") return "Kept · restart ADE to start using it";
  if (s.status === "preparing") return "Kept · getting your version ready";
  if (s.status === "waiting")
    return s.waitingFor
      ? `Kept · waiting for ${agentsWord(s.waitingFor)} to finish, then ADE restarts`
      : "Kept · ADE restarts when the running agents finish";
  if (s.status === "restarting") return "Restarting ADE on your version";
  if (s.status === "failed")
    return s.step === "build"
      ? "Your version couldn't be built, so ADE stays as it is"
      : "Your version didn't start, so ADE went back";
  return null;
}

export { agentsWord };

/** A failed check's label, short enough for a row; the detail lives in its summary. */
export function checkLabel(check: { id: string; label: string }) {
  return check.id === "design-lock" ? "Design files" : check.label;
}

/** Why Keep it is off, in the user's words. Null when it can be kept. */
export function keepBlockedReason(change: Change): string | null {
  switch (change.status) {
    case "ready":
      return null;
    case "working":
      return "The agent is still working.";
    case "checking":
      return "Checks are running. Keep it turns on when they all pass.";
    case "fixing":
      return "A check failed and the agent is fixing it.";
    case "failed":
      return "A check still fails. Ask the agent to fix it, or undo.";
    case "needs-you":
      return change.reason ?? "The agent needs you before this can be kept.";
    case "kept":
      return "Already kept.";
    case "removed":
      return "This change was removed.";
  }
}

/** One plain line under the title: where the change stands and what happens next. */
export function changeDetail(change: Change, state: CustomizeState): string {
  const done = change.checks.filter((c) => c.status !== "pending" && c.status !== "running").length;
  switch (change.status) {
    case "working":
      return "The agent is working in your private copy of ADE";
    case "checking":
      return change.checks.length
        ? `Running checks · ${done} of ${change.checks.length} done`
        : "Running checks";
    case "fixing":
      return `Checks failed · the agent is fixing this (attempt ${Math.max(1, change.fixAttempts)} of 2)`;
    case "ready": {
      const skipped = change.checks.filter((c) => c.status === "skipped").length;
      return skipped
        ? `Ready to try · checks passed, ${skipped} skipped`
        : "Ready to try · all checks passed";
    }
    case "failed":
      return "Checks failed after two fixes · ask the agent or undo";
    case "needs-you":
      return change.reason ?? "The agent needs you";
    case "kept": {
      const kept = state.changes.filter((c) => c.status === "kept").length;
      const note = switchNote(state);
      if (note) return note;
      return runningWithoutChanges(state)
        ? "Kept · ADE is running without your changes"
        : `You're on your version · ADE ${state.version} · ${kept} change${kept === 1 ? "" : "s"}`;
    }
    case "removed":
      return "Removed from your version";
  }
}
