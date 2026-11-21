// Updates: when ADE itself is newer than the copy's stock source, import the new
// version as a commit on `stock`, then re-apply every kept change onto it one by
// one (cherry-pick, with the agent resolving conflicts and failing checks), in a
// separate working folder so the running kept build is never touched. When all of
// them apply and the checks pass, `mine` moves to the result and the switch is
// pending; the user restarts when ready.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGit } from "./git.mjs";
import { exportStock } from "./source.mjs";
import { runChecks } from "./checks.mjs";
import { depsHash, provideDeps } from "./builds.mjs";
import { SELF_UPDATE_PROJECT_ID } from "./paths.mjs";
import { selfProjectRecord } from "./setup.mjs";
import { CustomizeError, MAX_FIX_ATTEMPTS, SCOPE_RULES, hasChangeInProgress } from "./changes.mjs";

const BRANCH = "update-work";
const IMPORT_BRANCH = "update-import";
const CONFLICT_MARKER = /^(<{7}|>{7})( |$)/m;

/** Numeric x.y.z comparison; anything after a dash or plus is ignored. */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v)
      .split(/[-+]/)[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const tail = (text, n = 60) =>
  String(text ?? "")
    .trim()
    .split(/\r?\n/)
    .slice(-n)
    .join("\n");

/** What the API shows of an update: no commit ids or retry counters. */
export const updateView = (update) =>
  update
    ? {
        from: update.from,
        to: update.to,
        status: update.status,
        ...(update.reason ? { reason: update.reason } : {}),
        ...(update.checks ? { checks: update.checks } : {}),
        changes: update.changes.map(({ id, title, status, reason, sessionId }) => ({
          id,
          title,
          status,
          ...(reason ? { reason } : {}),
          ...(sessionId ? { sessionId } : {}),
        })),
      }
    : null;

/** @param {any} ctx the customize context */
export function createUpdater(ctx) {
  const { paths } = ctx;
  const work = paths.updateWork;
  const wgit = createGit({ run: ctx.run, cwd: work });
  const waiters = new Map();
  let running = null;
  let token = 0;

  const update = () => ctx.data.update;
  const touch = (patch = {}) => {
    Object.assign(update(), patch);
    ctx.changed();
  };
  const entryOf = (id) => update()?.changes.find((item) => item.id === id);
  const changeOf = (id) => ctx.data.changes.find((item) => item.id === id);

  async function recordedVersion() {
    if (ctx.data.stockVersion) return ctx.data.stockVersion;
    const subject = (await ctx.git(["log", "-1", "--format=%s", "stock"])).stdout.trim();
    return /^ADE (\S+)/.exec(subject)?.[1] ?? "";
  }

  /** Kept changes still in effect, in the order they landed on `mine`. */
  async function keptInOrder() {
    const order = (await ctx.git(["rev-list", "--reverse", "stock..mine"])).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    return ctx.data.changes
      .filter((change) => change.status === "kept" && order.includes(change.commit))
      .sort((a, b) => order.indexOf(a.commit) - order.indexOf(b.commit));
  }

  async function cleanupWork() {
    await ctx.git(["worktree", "remove", "--force", work]);
    await fs.rm(work, { recursive: true, force: true });
    await ctx.git(["worktree", "prune"]);
  }
  async function dropBranches() {
    await ctx.git(["branch", "-D", BRANCH]);
    await ctx.git(["branch", "-D", IMPORT_BRANCH]);
  }

  /** The old stock tree is replaced by the new release's files in one commit. */
  async function importStock(stockInfo) {
    await fs.mkdir(paths.update, { recursive: true, mode: 0o700 });
    await ctx.git.must(["worktree", "add", "--detach", work, "stock"]);
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "ade-update-"));
    try {
      await exportStock(stockInfo, scratch, { run: ctx.run });
      for (const name of await fs.readdir(work)) {
        if (name === ".git") continue;
        await fs.rm(path.join(work, name), { recursive: true, force: true });
      }
      await fs.cp(scratch, work, { recursive: true });
    } finally {
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
    await wgit.must(["add", "-A"]);
    await wgit.must(["commit", "--allow-empty", "-m", `ADE ${update().to}`]);
    const sha = await wgit.must(["rev-parse", "HEAD"]);
    await ctx.git.must(["branch", "-f", IMPORT_BRANCH, sha]);
    return sha;
  }

  /** The working folder at the imported stock commit, with its dependencies. */
  async function prepareWork() {
    await cleanupWork();
    let sha = update().importSha;
    if (sha && (await ctx.git(["cat-file", "-e", `${sha}^{commit}`])).code !== 0) sha = undefined;
    if (sha) await ctx.git.must(["worktree", "add", "-B", BRANCH, work, sha]);
    else {
      const stockInfo = await ctx.resolveStock(true);
      if (!stockInfo.available) throw new Error(stockInfo.reason);
      sha = await importStock(stockInfo);
      await wgit.must(["checkout", "-B", BRANCH, sha]);
      touch({ importSha: sha });
    }
    await registerUpdateProject();
    await provideDeps({
      paths,
      run: ctx.run,
      dir: work,
      installed: await ctx.installedDeps(),
      home: path.join(paths.homes, "update-install"),
      timeout: ctx.checkTimeout,
    });
    return sha;
  }

  async function registerUpdateProject() {
    const projects = ctx.appState.projects;
    const record = {
      ...selfProjectRecord(ctx),
      id: SELF_UPDATE_PROJECT_ID,
      name: "ADE (update)",
      path: work,
    };
    const existing = projects.find((project) => project.id === SELF_UPDATE_PROJECT_ID);
    if (existing) Object.assign(existing, { hidden: true, kind: "ade-self", path: work });
    else projects.push(record);
    if (ctx.appState.deletedProjects) delete ctx.appState.deletedProjects[SELF_UPDATE_PROJECT_ID];
    await ctx.saveApp();
  }

  const cancelled = (mine) => update() === null || mine !== token;

  /** One agent turn in the working folder; true when the turn ended cleanly. */
  async function agentTurn(entry, change, text, attempt) {
    const to = update().to;
    let session = entry.sessionId ? ctx.deps.getSession(entry.sessionId) : null;
    const wait = (id) => new Promise((resolve) => waiters.set(id, resolve));
    if (session) {
      const done = wait(session.id);
      await ctx.deps.sendMessage(session, text, {
        kind: "ade",
        text: `ADE asked the agent to try again (attempt ${attempt} of ${MAX_FIX_ATTEMPTS})`,
        references: [],
      });
      await done;
    } else {
      session = await ctx.deps.startSession({
        projectId: SELF_UPDATE_PROJECT_ID,
        agentId: change.agentId,
        permission: "build",
        criteria: "",
        request: `${SCOPE_RULES}\n${text}`,
        presentation: {
          text: `Re-apply this change to ADE ${to}: ${change.title}`,
          references: [],
        },
      });
      entry.sessionId = session.id;
      ctx.changed();
      if (!ctx.orphans.delete(session.id)) await wait(session.id);
    }
    const finished = ctx.deps.getSession(session.id) ?? session;
    return finished.status === "ready";
  }

  const intro = (entry, change) =>
    `Re-apply this change to ADE ${update().to}: ${change.title}. Original request: ${change.request}`;

  async function conflictedFiles() {
    const out = await wgit(["diff", "--name-only", "--diff-filter=U"]);
    return out.stdout.split(/\r?\n/).filter(Boolean);
  }
  async function stillMarked(files) {
    for (const file of files) {
      const text = await fs.readFile(path.join(work, file), "utf8").catch(() => "");
      if (CONFLICT_MARKER.test(text)) return file;
    }
    return null;
  }

  /** The cherry-pick stopped on conflicts: ask the agent (up to two attempts) to resolve them. */
  async function resolveConflict(entry, change, sha, mine) {
    const files = await conflictedFiles();
    let note = "";
    while (entry.attempts < MAX_FIX_ATTEMPTS) {
      entry.attempts += 1;
      const text = `${intro(entry, change)}\n\nThe change was kept on the previous ADE version as commit ${sha}. Applying it to ADE ${update().to} stopped with conflicts in:\n${files.map((f) => `- ${f}`).join("\n")}\n\nResolve the conflicts so the change works on the new version and keep its intent. Remove every conflict marker. Do not commit.${note}`;
      const ok = await agentTurn(entry, change, text, entry.attempts);
      if (cancelled(mine)) return false;
      if (!ok) {
        note = "\n\nThe last turn did not finish. Try again.";
        continue;
      }
      const marked = await stillMarked(files);
      if (marked) {
        note = `\n\n${marked} still has conflict markers. Remove them.`;
        continue;
      }
      await wgit(["add", "-A"]);
      const done = await wgit(["-c", "core.editor=true", "cherry-pick", "--continue"]);
      if (done.code === 0) return true;
      note = `\n\nGit could not finish: ${tail(done.stderr || done.stdout, 6)}`;
    }
    await wgit(["cherry-pick", "--abort"]);
    entry.reason = `It conflicts with ADE ${update().to} in ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}.`;
    return false;
  }

  /** Apply one change's commits; true when it is in the working branch. */
  async function pick(entry, change, mine) {
    const original = !entry.parts?.length;
    const queue = original ? (change.commits ?? [change.commit]) : [...entry.parts];
    const base = await wgit.must(["rev-parse", "HEAD"]);
    const produced = [];
    for (const sha of queue) {
      const picked = await wgit(["cherry-pick", "--allow-empty", "--keep-redundant-commits", sha]);
      if (picked.code !== 0) {
        if ((await conflictedFiles()).length === 0) {
          await wgit(["cherry-pick", "--abort"]);
          entry.reason = tail(picked.stderr || picked.stdout, 4);
          return false;
        }
        if (!(await resolveConflict(entry, change, sha, mine))) return false;
      }
      produced.push(await wgit.must(["rev-parse", "HEAD"]));
    }
    entry.parts = produced;
    const touched = await wgit(["diff", "--name-only", `${base}..HEAD`]);
    entry.files = touched.stdout.split(/\r?\n/).filter(Boolean);
    return true;
  }

  async function attributeFailure(checks) {
    const entries = update().changes.filter((item) => item.status !== "dropped");
    const text = checks
      .filter((check) => check.status === "failed")
      .map((check) => `${check.output ?? ""}\n${(check.failures ?? []).join("\n")}`)
      .join("\n");
    const hit = [...entries]
      .reverse()
      .find((item) => item.files?.some((file) => text.includes(file)));
    return hit ?? entries.at(-1);
  }

  async function verify(importSha, mine) {
    for (;;) {
      const checks = await runChecks({
        run: ctx.run,
        git: ctx.git,
        sourceDir: work,
        home: path.join(paths.homes, "update-check"),
        branch: BRANCH,
        base: importSha,
        onUpdate: (rows) => {
          if (cancelled(mine)) return;
          update().checks = rows.map(({ id, label, status, summary }) => ({
            id,
            label,
            status,
            ...(summary ? { summary } : {}),
          }));
          ctx.changed();
        },
        cancelled: () => cancelled(mine),
        timeout: ctx.checkTimeout,
      });
      if (cancelled(mine)) return false;
      const failed = checks.filter((check) => check.status === "failed");
      if (!failed.length) return true;
      const entry = await attributeFailure(checks);
      const change = entry && changeOf(entry.id);
      const names = failed.map((check) => check.label).join(", ");
      if (!entry || !change) throw new Error(`${names} did not pass on ADE ${update().to}.`);
      if (entry.attempts >= MAX_FIX_ATTEMPTS) {
        entry.status = "needs-you";
        entry.reason = `${names} did not pass on ADE ${update().to}.`;
        return false;
      }
      entry.status = "applying";
      entry.attempts += 1;
      ctx.changed();
      const report = failed
        .map(
          (check) =>
            `Check "${check.label}" failed (${check.summary}).\n${(check.failures ?? []).map((f) => `- ${f}`).join("\n")}\nLast 80 lines:\n${(check.output ?? "").split("\n").slice(-80).join("\n")}`,
        )
        .join("\n\n");
      const text = `${intro(entry, change)}\n\nThe change is applied to ADE ${update().to}, but ADE's checks failed after it. Fix the change so they pass, without touching protected design files.\n\n${report}`;
      const ok = await agentTurn(entry, change, text, entry.attempts);
      if (cancelled(mine)) return false;
      if (ok) {
        await wgit(["add", "-A"]);
        const staged = await wgit(["diff", "--cached", "--quiet"]);
        if (staged.code === 1) {
          await wgit.must(["commit", "-m", `${change.title} (fixed for ${update().to})`]);
          entry.parts = [...entry.parts, await wgit.must(["rev-parse", "HEAD"])];
          const more = await wgit(["diff", "--name-only", "HEAD~1..HEAD"]);
          entry.files = [
            ...new Set([...(entry.files ?? []), ...more.stdout.split(/\r?\n/).filter(Boolean)]),
          ];
        }
      }
      entry.status = "applied";
      ctx.changed();
    }
  }

  /** Re-apply every change that is not dropped, from the imported stock commit. */
  async function apply(importSha, mine) {
    await wgit.must(["checkout", "-f", "-B", BRANCH, importSha]);
    await wgit(["clean", "-fd"]);
    for (const entry of update().changes) {
      if (entry.status === "dropped") continue;
      if (entry.status === "needs-you") return false;
      const change = changeOf(entry.id);
      if (!change) {
        entry.status = "dropped";
        continue;
      }
      entry.status = "applying";
      delete entry.reason;
      ctx.changed();
      const ok = await pick(entry, change, mine);
      if (cancelled(mine)) return false;
      if (!ok) {
        entry.status = "needs-you";
        entry.reason ??= `It could not be applied to ADE ${update().to}.`;
        return false;
      }
      entry.status = "applied";
      ctx.changed();
    }
    return true;
  }

  async function finish(importSha) {
    const to = update().to;
    const head = await ctx.git.must(["rev-parse", `refs/heads/${BRANCH}`]);
    await ctx.git.must(["checkout", "-f", "mine"]);
    await ctx.git.must(["update-ref", "refs/heads/stock", importSha]);
    await ctx.git.must(["update-ref", "refs/heads/mine", head]);
    await ctx.git.must(["reset", "--hard", "mine"]);
    for (const entry of update().changes) {
      const change = changeOf(entry.id);
      if (!change) continue;
      if (entry.status === "dropped") {
        Object.assign(change, {
          status: "removed",
          reason: `Left out of the update to ADE ${to}.`,
          updatedAt: new Date(ctx.now()).toISOString(),
        });
      } else if (entry.parts?.length) {
        change.commits = [...entry.parts];
        change.commit = entry.parts[0];
      }
    }
    ctx.data.stockVersion = to;
    touch({ status: "done" });
    await ctx.switcher.mineChanged();
    await ctx.switcher.settled();
    await settleDone();
  }

  /** The update is finished for good once nothing is left to restart into. */
  async function settleDone() {
    const now = update();
    if (!now || now.status !== "done") return;
    if (
      ["pending", "preparing", "waiting", "restarting", "failed"].includes(ctx.data.switch.status)
    )
      return;
    // The copy's own dependencies follow the new version once nothing runs from them.
    const own = path.join(work, "node_modules");
    const link = await fs.lstat(own).catch(() => null);
    if (link?.isDirectory() && !link.isSymbolicLink()) {
      await fs.rm(path.join(paths.source, "node_modules"), { recursive: true, force: true });
      await fs.rename(own, path.join(paths.source, "node_modules"));
    }
    ctx.data.installedDeps = await depsHash(paths.source);
    await cleanupWork();
    await dropBranches();
    ctx.data.update = null;
    ctx.changed();
  }

  async function run() {
    const mine = ++token;
    try {
      const importSha = await prepareWork();
      if (cancelled(mine)) return;
      if (!(await apply(importSha, mine))) {
        if (cancelled(mine)) return;
        return touch({ status: "needs-you" });
      }
      if (
        update().changes.some((item) => item.status !== "dropped") &&
        !(await verify(importSha, mine))
      ) {
        if (cancelled(mine)) return;
        return touch({ status: "needs-you" });
      }
      if (cancelled(mine)) return;
      await finish(importSha);
    } catch (error) {
      if (cancelled(mine)) return;
      touch({ status: "needs-you", reason: error?.message ?? String(error) });
    }
  }

  function kick() {
    if (running) return running;
    const now = update();
    if (now) {
      now.status = "applying";
      delete now.reason;
      ctx.changed();
    }
    running = run().finally(() => (running = null));
    return running;
  }

  const blocked = () => {
    if (hasChangeInProgress(ctx))
      return "Finish or undo the change in progress; ADE will update your changes afterwards.";
    if (["preparing", "waiting", "restarting"].includes(ctx.data.switch.status))
      return "ADE is switching versions right now.";
    return null;
  };

  return {
    /** Is the version ADE runs newer than the copy's? Starts the update when it is. */
    async check() {
      if (ctx.data.setup.status !== "ready") return { started: false, reason: "not set up" };
      if (update()) {
        if (update().status === "applying" && !running) void kick();
        return { started: false, reason: "already updating" };
      }
      const found = await ctx.resolveStock(true);
      if (!found.available || !found.version) return { started: false, reason: "no source" };
      const recorded = await recordedVersion();
      if (!recorded || compareVersions(found.version, recorded) <= 0)
        return { started: false, reason: "up to date" };
      if (ctx.data.stayedOn && compareVersions(found.version, ctx.data.stayedOn) <= 0)
        return { started: false, reason: "staying" };
      const why = blocked();
      if (why) return { started: false, reason: why };
      const kept = await keptInOrder();
      ctx.data.update = {
        from: recorded,
        to: found.version,
        status: "applying",
        changes: kept.map((change) => ({
          id: change.id,
          title: change.title,
          status: "applying",
          attempts: 0,
          parts: [],
        })),
      };
      ctx.changed();
      void kick();
      return { started: true };
    },

    /** The agent tries again on a change that needs you. */
    async retry(changeId) {
      const entry = entryOf(changeId);
      if (!entry || entry.status !== "needs-you")
        throw new CustomizeError(409, "That change is not waiting for you.");
      Object.assign(entry, { status: "applying", attempts: 0 });
      delete entry.reason;
      delete entry.sessionId;
      if (!running) void kick();
      return updateView(update());
    },

    /** Update without this change: it is dropped from your version. */
    async skip(changeId) {
      const entry = entryOf(changeId);
      if (!entry || !["needs-you", "applying"].includes(entry.status))
        throw new CustomizeError(409, "That change cannot be left out now.");
      if (running) throw new CustomizeError(409, "Wait until ADE has finished its current step.");
      Object.assign(entry, { status: "dropped", parts: [], files: [] });
      entry.reason = `Left out of the update to ADE ${update().to}.`;
      void kick();
      return updateView(update());
    },

    /** Stay on the current version: forget this attempt and do not offer it again. */
    async stay() {
      const now = update();
      if (!now) return null;
      if (now.status === "done")
        throw new CustomizeError(409, "Your changes are already updated. Restart ADE to use them.");
      const to = now.to;
      token += 1;
      for (const entry of now.changes) {
        const session = entry.sessionId && ctx.deps.getSession(entry.sessionId);
        if (session && ctx.deps.isBusy(session))
          await ctx.deps.stopSession(session).catch(() => {});
      }
      for (const [id, resolve] of waiters) {
        waiters.delete(id);
        resolve(false);
      }
      ctx.data.update = null;
      ctx.data.stayedOn = to;
      ctx.changed();
      await running?.catch(() => {});
      await cleanupWork();
      await dropBranches();
      return null;
    },

    /** A turn ended in the working folder: wake whoever waits for it. */
    onTurnEnd(session) {
      if (session.projectId !== SELF_UPDATE_PROJECT_ID) return false;
      const resolve = waiters.get(session.id);
      if (resolve) {
        waiters.delete(session.id);
        resolve(true);
      } else ctx.orphans.add(session.id);
      return true;
    },

    /** ADE started: pick up an interrupted update, or finish one that was waiting for a restart. */
    async resume() {
      const now = update();
      if (!now) return;
      if (now.status === "applying") void kick();
      else if (now.status === "done") await settleDone();
    },

    settled: async () => {
      await running;
    },
  };
}
