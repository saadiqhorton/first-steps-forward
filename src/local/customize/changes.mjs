import path from "node:path";
import { createGit } from "./git.mjs";
import { pendingChecks, runChecks } from "./checks.mjs";
import { SELF_PROJECT_ID, SELF_UPDATE_PROJECT_ID } from "./paths.mjs";

export class CustomizeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MAX_FIX_ATTEMPTS = 2;
const ACTIVE = ["working", "checking", "fixing", "ready", "failed", "needs-you"];
const RUNNING = ["working", "checking", "fixing"];

export const SCOPE_RULES = [
  "You are changing the user's private copy of ADE. Rules:",
  "- Work only inside this folder.",
  "- Functionality, tools and features only. Never edit src/tokens.css, src/styles.css, design/, src/components/ui/ or src/components/arc/.",
  "- Do not start servers.",
  "- Add or update tests for behavior you change.",
  "- The user will try the change in a preview, so say briefly what to look for.",
  "",
  "The change the user wants:",
].join("\n");

const titleOf = (request) =>
  request
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 60) ?? "Change";
const branchOf = (change) => `change/${change.id}`;
const isoNow = (ctx) => new Date(ctx.now()).toISOString();
const inProgress = (change) => ACTIVE.includes(change.status) && !change.commit;
export const hasChangeInProgress = (ctx) => ctx.data.changes.some(inProgress);

export const findChange = (ctx, id) => {
  const change = ctx.data.changes.find((item) => item.id === id);
  if (!change || change.status === "undone") throw new CustomizeError(404, "Change not found.");
  return change;
};

const touch = (ctx, change, patch = {}) => {
  Object.assign(change, patch, { updatedAt: isoNow(ctx) });
  ctx.changed();
};

/** What a person sees: a follow-up the agent is working on shows as working. */
export function viewOf(ctx, change) {
  const session = ctx.deps.getSession(change.sessionId);
  const working =
    ["ready", "failed", "needs-you"].includes(change.status) &&
    !change.commit &&
    session &&
    ctx.deps.isBusy(session);
  const { previewProcess: _process, build: _build, ...shown } = change;
  return { ...shown, ...(working ? { status: "working", reason: undefined } : {}) };
}

async function filesOf(ctx, change) {
  const out = await ctx.git(["diff", "--numstat", `mine...${branchOf(change)}`]);
  if (out.code !== 0) return [];
  return out.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split("\t");
      return { path: rest.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    });
}

export async function createChange(ctx, input) {
  if (ctx.data.setup.status !== "ready")
    throw new CustomizeError(409, "Set up customization first.");
  const request = String(input.request ?? "").trim();
  if (request.length < 4)
    throw new CustomizeError(400, "Describe the change in at least four characters.");
  if (ctx.data.changes.some(inProgress))
    throw new CustomizeError(409, "Finish or undo the change in progress before starting another.");
  if (ctx.data.update?.status === "applying" || ctx.data.update?.status === "needs-you")
    throw new CustomizeError(
      409,
      "ADE is updating your changes to the new version. Start a new change when that is done.",
    );
  const id = ctx.id();
  const branch = `change/${id}`;
  await ctx.git.must(["checkout", "-f", "mine"]);
  await ctx.git.must(["checkout", "-b", branch, "mine"]);
  let session;
  try {
    session = await ctx.deps.startSession({
      projectId: SELF_PROJECT_ID,
      agentId: input.agentId,
      model: input.model,
      effort: input.effort,
      permission: "build",
      criteria: String(input.criteria ?? ""),
      request: `${SCOPE_RULES}\n${request}`,
      presentation: { text: request, references: [] },
    });
  } catch (error) {
    await ctx.git(["checkout", "-f", "mine"]);
    await ctx.git(["branch", "-D", branch]);
    throw error;
  }
  const stamp = isoNow(ctx);
  const change = {
    id,
    title: titleOf(request),
    request,
    ...(input.criteria ? { criteria: String(input.criteria) } : {}),
    status: "working",
    sessionId: session.id,
    agentId: session.agentId,
    createdAt: stamp,
    updatedAt: stamp,
    files: [],
    checks: [],
    fixAttempts: 0,
    preview: { status: "stopped" },
  };
  ctx.data.changes.unshift(change);
  ctx.changed();
  if (ctx.orphans.delete(session.id)) onTurnEnd(ctx, session);
  return viewOf(ctx, change);
}

/** Session machinery tells us a turn finished; advance that change. */
export function onTurnEnd(ctx, session) {
  if (ctx.updater?.onTurnEnd(session)) return;
  const change = ctx.data.changes.find((item) => item.sessionId === session.id);
  if (!change) {
    if (session.projectId === SELF_PROJECT_ID) ctx.orphans.add(session.id);
    return;
  }
  if (!inProgress(change)) return;
  ctx.enqueue(change.id, () => afterTurn(ctx, change, session));
}

async function afterTurn(ctx, change, session) {
  if (!inProgress(change)) return;
  const needsYou = (reason) => touch(ctx, change, { status: "needs-you", reason });
  if (session.status === "stopped") return needsYou("The agent was stopped.");
  if (session.status !== "ready") {
    const note = [...(session.messages ?? [])].reverse().find((m) => m.role === "system")?.text;
    return needsYou(note || "The agent stopped before finishing.");
  }
  const branch = branchOf(change);
  const head = await ctx.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.stdout.trim() !== branch)
    return needsYou("The agent moved away from this change's working copy.");
  await ctx.git.must(["add", "-A"]);
  const staged = await ctx.git(["diff", "--cached", "--quiet"]);
  if (staged.code === 1) await ctx.git.must(["commit", "-m", change.title]);
  const files = await filesOf(ctx, change);
  touch(ctx, change, { files });
  if (!files.length) return needsYou("The agent finished without changing anything.");
  await checkChange(ctx, change, { auto: true });
}

async function checkChange(ctx, change, { auto }) {
  await ctx.previews?.stop(change.id);
  touch(ctx, change, { status: "checking", reason: undefined, checks: pendingChecks() });
  const sha = (await ctx.git(["rev-parse", "HEAD"])).stdout.trim();
  const checks = await runChecks({
    run: ctx.run,
    git: ctx.git,
    sourceDir: ctx.paths.source,
    home: path.join(ctx.paths.homes, `check-${change.id}`),
    branch: branchOf(change),
    onUpdate: (rows) => {
      change.checks = rows.map((row) => ({ ...row }));
      ctx.changed();
    },
    cancelled: () => !inProgress(change),
    timeout: ctx.checkTimeout,
  });
  if (!inProgress(change)) return;
  // The build check left this commit's output in the copy; Try it serves it as is.
  const build = checks.find((check) => check.id === "build");
  if (build?.status === "passed" && sha) change.build = { sha };
  else delete change.build;
  touch(ctx, change, { checks });
  const failed = checks.filter((check) => check.status === "failed");
  if (!failed.length) return touch(ctx, change, { status: "ready", reason: undefined });
  const names = failed.map((check) => check.label).join(", ");
  if (!auto || change.fixAttempts >= MAX_FIX_ATTEMPTS)
    return touch(ctx, change, { status: "failed", reason: `${names} did not pass.` });
  const session = ctx.deps.getSession(change.sessionId);
  const report = failed
    .map((check) =>
      [
        `Check "${check.label}" failed (${check.summary}).`,
        ...(check.failures?.length ? ["What failed:", ...check.failures.map((f) => `- ${f}`)] : []),
        "Last 80 lines:",
        (check.output ?? "").split("\n").slice(-80).join("\n"),
      ].join("\n"),
    )
    .join("\n\n");
  const attempt = change.fixAttempts + 1;
  touch(ctx, change, {
    status: "fixing",
    reason: `${names} did not pass. The agent is fixing it.`,
    fixAttempts: attempt,
  });
  try {
    await ctx.deps.sendMessage(
      session,
      `ADE ran its checks and some failed. Fix them without touching protected design files.\n\n${report}`,
      fixPresentation(failed, attempt),
    );
  } catch (error) {
    touch(ctx, change, { status: "failed", reason: error?.message ?? String(error) });
  }
}

/** "Tests", "Tests and Lint", "Typecheck, Tests and Lint". */
const listOf = (labels) =>
  labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

/**
 * How an automatic fix prompt shows in the conversation: one line from ADE,
 * not the 80-line prompt the agent receives (`kind: "ade"` marks the row).
 */
export const fixPresentation = (failed, attempt) => ({
  kind: "ade",
  text: `ADE sent the failing ${listOf(failed.map((check) => check.label))} output to the agent (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`,
  references: [],
});

export async function rerunChecks(ctx, id) {
  const change = findChange(ctx, id);
  if (!["ready", "failed", "needs-you"].includes(change.status) || change.commit)
    throw new CustomizeError(409, "Checks can run when the change is not being worked on.");
  const session = ctx.deps.getSession(change.sessionId);
  if (session && ctx.deps.isBusy(session))
    throw new CustomizeError(409, "Wait for the agent to finish first.");
  await ctx.previews?.stop(change.id);
  touch(ctx, change, { status: "checking", reason: undefined, checks: pendingChecks() });
  ctx.enqueue(change.id, async () => {
    const files = await filesOf(ctx, change);
    change.files = files;
    await checkChange(ctx, change, { auto: false });
  });
  return viewOf(ctx, change);
}

export async function keepChange(ctx, id) {
  const change = findChange(ctx, id);
  const live = viewOf(ctx, change);
  if (live.status !== "ready" || change.commit)
    throw new CustomizeError(409, "Only a change that passed its checks can be kept.");
  await ctx.previews?.stop(change.id);
  // The tree the checks (or Try it) last built in the copy, so the kept version can reuse it.
  const builtTree = change.build?.sha
    ? (await ctx.git(["rev-parse", `${change.build.sha}^{tree}`])).stdout.trim() || null
    : null;
  await ctx.git.must(["checkout", "-f", "mine"]);
  await ctx.git.must(["merge", "--squash", branchOf(change)]);
  await ctx.git.must(["commit", "-m", change.title]);
  const commit = await ctx.git.must(["rev-parse", "HEAD"]);
  await ctx.git(["branch", "-D", branchOf(change)]);
  delete change.build;
  touch(ctx, change, { status: "kept", commit, keptAt: isoNow(ctx), reason: undefined });
  await ctx.switcher?.mineChanged({ reuseTree: builtTree });
  return viewOf(ctx, change);
}

export async function undoChange(ctx, id) {
  const change = findChange(ctx, id);
  if (change.status === "kept" || change.status === "removed" || change.commit)
    throw new CustomizeError(409, "A kept change is removed, not undone.");
  const session = ctx.deps.getSession(change.sessionId);
  // Mark first so a running pipeline stops between steps, then wait for it.
  change.status = "undone";
  if (session && ctx.deps.isBusy(session)) await ctx.deps.stopSession(session);
  await ctx.previews?.stop(change.id);
  await ctx.pipeline(change.id);
  await ctx.git(["checkout", "-f", "mine"]);
  await ctx.git(["clean", "-fd"]);
  await ctx.git(["branch", "-D", branchOf(change)]);
  touch(ctx, change, { status: "undone" });
  return { ok: true };
}

export async function removeChange(ctx, id) {
  const change = findChange(ctx, id);
  if (change.status !== "kept" || !change.commit)
    throw new CustomizeError(409, "Only a kept change can be removed.");
  if (ctx.data.changes.some(inProgress))
    throw new CustomizeError(409, "Finish or undo the change in progress first.");
  await ctx.previews?.stopAll();
  await ctx.git.must(["checkout", "-f", "mine"]);
  const reverted = await ctx.git(["revert", "--no-edit", change.commit]);
  if (reverted.code !== 0) {
    await ctx.git(["revert", "--abort"]);
    await ctx.git(["checkout", "-f", "mine"]);
    touch(ctx, change, {
      status: "needs-you",
      reason: "Removing it conflicts with changes kept after it. Ask the agent to remove it.",
    });
    return viewOf(ctx, change);
  }
  touch(ctx, change, { status: "removed", reason: undefined });
  await ctx.switcher?.mineChanged();
  return viewOf(ctx, change);
}

export { RUNNING, ACTIVE, createGit };
