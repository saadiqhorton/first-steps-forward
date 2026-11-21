import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runCommand as defaultRun } from "../spawn.mjs";
import { createGit } from "./git.mjs";
import { createStore } from "./store.mjs";
import { selfPaths, SELF_PROJECT_ID } from "./paths.mjs";
import { resolveStock } from "./source.mjs";
import { registerSelfProject, runSetup } from "./setup.mjs";
import { createPreviews } from "./preview.mjs";
import {
  CustomizeError,
  createChange,
  keepChange,
  onTurnEnd,
  removeChange,
  rerunChecks,
  undoChange,
  viewOf,
} from "./changes.mjs";

export { CustomizeError };

const DEFAULT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The Customize ADE service: setup of a private copy of ADE's source and the
 * lifecycle of changes the agent makes in it. Everything outside is injected.
 * @param {{
 *   dataDir: string,
 *   appState: { projects: any[], deletedProjects?: Record<string, number> },
 *   saveApp: () => Promise<void>,
 *   emit?: (scope: string) => void,
 *   deps: {
 *     startSession: (input: object) => Promise<any>,
 *     sendMessage: (session: any, text: string) => Promise<any>,
 *     stopSession: (session: any) => Promise<any>,
 *     getSession: (id: string) => any,
 *     isBusy: (session: any) => boolean,
 *   },
 *   sourceRoot?: string,
 *   run?: typeof defaultRun,
 *   now?: () => number,
 *   id?: () => string,
 *   launcher?: boolean,
 *   checkTimeout?: number,
 *   preview?: Parameters<typeof createPreviews>[1],
 * }} options
 */
export function createCustomize({
  dataDir,
  appState,
  saveApp,
  emit = () => {},
  deps,
  sourceRoot = DEFAULT_ROOT,
  run = defaultRun,
  now = () => Date.now(),
  id = () => randomUUID(),
  launcher = false,
  checkTimeout = 600_000,
  preview = {},
}) {
  const paths = selfPaths(dataDir);
  const store = createStore(paths.state);
  const pipelines = new Map();
  let writes = Promise.resolve();
  let stock = null;
  let setupRun = null;
  /** @type {import("./store.mjs").emptyState extends () => infer T ? T : never} */
  let data = {
    setup: { status: "none" },
    changes: [],
    current: { stock: true, sha: null },
    switch: { status: "idle" },
    update: null,
  };

  const ctx = {
    paths,
    run,
    now,
    id,
    deps,
    appState,
    saveApp,
    launcher,
    checkTimeout,
    orphans: new Set(),
    get data() {
      return data;
    },
    git: createGit({ run, cwd: paths.source }),
    changed() {
      writes = writes.then(() => store.save(data)).catch(() => {});
      emit("customize");
    },
    resolveStock: async () => (stock ??= await resolveStock({ sourceRoot, run })),
    pipeline: (changeId) => pipelines.get(changeId) ?? Promise.resolve(),
    enqueue(changeId, fn) {
      const next = (pipelines.get(changeId) ?? Promise.resolve()).then(fn).catch((error) => {
        const change = data.changes.find((item) => item.id === changeId);
        if (change && !["undone", "kept", "removed"].includes(change.status)) {
          change.status = "needs-you";
          change.reason = error?.message ?? String(error);
          change.updatedAt = new Date(now()).toISOString();
          ctx.changed();
        }
      });
      pipelines.set(changeId, next);
      return next;
    },
  };

  const previews = createPreviews(ctx, preview);
  ctx.previews = previews;

  const runningSetup = () => data.setup.status === "running";

  return {
    paths,
    /** Load saved state; interrupted work becomes honest "needs you" / "failed" states. */
    async init() {
      data = await store.load();
      if (runningSetup())
        data.setup = {
          status: "failed",
          ...(data.setup.step ? { step: data.setup.step } : {}),
          error: "Setup was interrupted. Try again.",
        };
      for (const change of data.changes)
        if (["working", "checking", "fixing"].includes(change.status)) {
          change.status = "needs-you";
          change.reason = "ADE restarted while this was running.";
        }
      await previews.reset();
      if (data.setup.status === "ready") await registerSelfProject(ctx);
      ctx.changed();
    },

    async status() {
      const found = await ctx.resolveStock();
      return {
        available: found.available,
        ...(found.available ? {} : { unavailableReason: found.reason }),
        version: found.version,
        setup: data.setup,
        changes: data.changes.filter((c) => c.status !== "undone").map((c) => viewOf(ctx, c)),
        current: data.current,
        switch: { ...data.switch, status: data.switch.status ?? "idle", launcher },
        update: data.update,
      };
    },

    async startSetup() {
      const found = await ctx.resolveStock();
      if (!found.available) throw new CustomizeError(409, found.reason);
      if (data.setup.status === "ready" || runningSetup()) return data.setup;
      data.setup = {
        status: "running",
        step: "copy",
        progress: { done: 0, total: null, label: "Copying ADE's source" },
      };
      ctx.changed();
      setupRun = runSetup(ctx).finally(() => (setupRun = null));
      return data.setup;
    },

    createChange: (input) => createChange(ctx, input),
    rerunChecks: (changeId) => rerunChecks(ctx, changeId),
    keep: (changeId) => keepChange(ctx, changeId),
    undo: (changeId) => undoChange(ctx, changeId),
    remove: (changeId) => removeChange(ctx, changeId),
    onTurnEnd: (session) => onTurnEnd(ctx, session),
    /** A new agent turn on a change's session: its preview no longer shows the latest work. */
    onTurnStart(session) {
      const change = data.changes.find((item) => item.sessionId === session.id);
      if (change && ["starting", "running"].includes(change.preview?.status))
        void previews.stop(change.id).catch(() => {});
    },
    startPreview: (changeId) => previews.start(changeId),
    async stopPreview(changeId) {
      const change = data.changes.find((item) => item.id === changeId);
      if (!change || change.status === "undone") throw new CustomizeError(404, "Change not found.");
      await previews.stop(changeId);
      return viewOf(ctx, change);
    },
    /** ADE is shutting down: stop previews now (synchronous). */
    shutdown: () => previews.shutdown(),
    isSelfProject: (projectId) => projectId === SELF_PROJECT_ID,

    /** Wait for setup, change pipelines and state writes (tests, shutdown). */
    async idle() {
      await Promise.all([setupRun, ...pipelines.values(), previews.settled()]);
      await writes;
    },
  };
}
