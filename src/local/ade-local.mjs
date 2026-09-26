import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapters } from "./adapters/index.mjs";
import { classifyFailure, modelSuggestion, retryHint } from "./classify.mjs";
import { listModels, MODEL_ID } from "./models.mjs";

const DATA_DIR = path.join(os.homedir(), ".ade");
const DATA_FILE = path.join(DATA_DIR, "workspace.json");
const state = { projects: [], sessions: [], processes: [], agents: [] };
const children = new Map();
const authChildren = new Map();
const id = () => randomUUID();
const now = () => Date.now();
const UNSUPPORTED_RISK =
  /\b(?:deploy(?:ment)?|publish|release (?:to )?prod(?:uction)?|production (?:deployment|database)|git push|push (?:to )?(?:origin|remote|github|gitlab)|open (?:a )?pull request|create (?:a )?pull request|drop database|wipe (?:all )?(?:data|files)|delete all|send (?:an? )?email|charge (?:a )?(?:credit )?card)\b/i;

async function save() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify(
      { projects: state.projects, sessions: state.sessions, processes: state.processes },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await fs.rename(tmp, DATA_FILE);
}
async function load() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    state.projects = Array.isArray(saved.projects) ? saved.projects : [];
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
    state.processes = Array.isArray(saved.processes) ? saved.processes : [];
    let changed = false;
    for (const p of state.processes) {
      const project = state.projects.find((item) => item.id === p.projectId);
      const running = !!(p.pid && project && (await processMatches(p.pid, project.path)));
      if (p.status !== (running ? "running" : "stopped") || (!running && p.pid)) changed = true;
      p.status = running ? "running" : "stopped";
      if (!running) delete p.pid;
      p.output = p.output ?? [];
    }
    for (const s of state.sessions) {
      const active = ["working", "verifying"].includes(s.status);
      const project = state.projects.find((item) => item.id === s.projectId);
      if (s.pid && project && (await processMatches(s.pid, project.path))) stopChild(s.pid);
      if (active) {
        s.status = "stopped";
        addMessage(
          s,
          "system",
          "ADE restarted and stopped the interrupted CLI process. Any project edits made before it stopped are kept.",
        );
        changed = true;
      }
      if (s.pid) {
        delete s.pid;
        changed = true;
      }
    }
    if (changed) await save();
  } catch {}
}
async function processMatches(pid, projectPath) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux")
      return (await fs.realpath(`/proc/${pid}/cwd`)) === projectPath;
    if (process.platform === "darwin") {
      const result = await run("lsof", ["-Fn", "-a", "-p", String(pid), "-d", "cwd"], {
        timeout: 3000,
      });
      const cwd = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("n"))
        ?.slice(1);
      return cwd ? (await fs.realpath(cwd)) === projectPath : false;
    }
  } catch {}
  return false;
}
const run = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "";
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGTERM"), opts.timeout) : null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
async function executable(bin) {
  const res = await run(bin, ["--version"], { timeout: 5000 });
  return res.code === 0 ? (res.stdout || res.stderr).trim().split(/\r?\n/)[0].slice(0, 100) : null;
}
async function agentStatus() {
  const results = await Promise.all(
    Object.values(adapters).map(async (adapter) => {
      const version = await executable(adapter.bin);
      const auth = version ? await adapter.detectAuth(run) : { signedIn: false };
      return {
        id: adapter.id,
        name: adapter.name,
        short: adapter.short,
        authMethod: adapter.authMethod,
        authNote: adapter.authNote,
        installHint: adapter.installHint,
        installed: !!version,
        ...(version ? { version: version.replace(/^.*?\s/, "") } : {}),
        ...auth,
        carriesConversation: true,
      };
    }),
  );
  state.agents = results;
  return results;
}
const safeProject = (p) => ({ ...p });
async function git(project, args) {
  return run("git", ["-C", project.path, ...args], { timeout: 10000 });
}
async function projectInfo(project) {
  const branchRes = await git(project, ["branch", "--show-current"]);
  const statusRes = await git(project, ["status", "--porcelain=v1", "-uall"]);
  const changedFiles = statusRes.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3));
  const aheadRes = await git(project, ["rev-list", "--count", "@{upstream}..HEAD"]);
  project.branch =
    branchRes.code === 0 ? branchRes.stdout.trim() || "(detached)" : "not a git repository";
  project.uncommittedFiles = [...new Set(changedFiles)];
  project.ahead = aheadRes.code === 0 ? Number(aheadRes.stdout.trim()) || 0 : 0;
  return safeProject(project);
}
async function snapshotDigest(project) {
  const snapshot = await getDiff(project);
  return createHash("sha256")
    .update(JSON.stringify({ files: snapshot.files, changes: snapshot.changes }))
    .digest("hex");
}
async function getDiff(project) {
  const tracked = await git(project, ["diff", "HEAD", "--no-ext-diff", "--unified=3"]);
  const names = await git(project, ["status", "--porcelain=v1", "-uall"]);
  const diff = tracked.stdout;
  const changes = [];
  let current;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const filePath =
        line.match(/ (?:b|w)\/(.*)$/)?.[1] ?? line.slice("diff --git ".length).split(/\s+/).at(-1);
      current = { path: filePath, added: 0, removed: 0, hunk: [] };
      changes.push(current);
    } else if (current && line.startsWith("@@")) current.hunk.push(line);
    else if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      current.hunk.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
      if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
    }
  }
  const files = names.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));
  for (const f of files) {
    if (changes.some((c) => c.path === f.path)) continue;
    const absolute = path.resolve(project.path, f.path);
    const rel = path.relative(project.path, absolute);
    let hunk = [`${f.status || "??"} · diff unavailable (binary, oversized, or unreadable file)`];
    let added = 0;
    if (f.status === "??" && rel && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
      try {
        const stat = await fs.lstat(absolute);
        if (stat.isFile() && stat.size <= 262144) {
          const content = await fs.readFile(absolute);
          if (!content.includes(0)) {
            const lines = content.toString("utf8").split(/\r?\n/);
            added = lines.filter(
              (line, index) => index < lines.length - 1 || line.length > 0,
            ).length;
            hunk = ["@@ added file @@", ...lines.map((line) => `+${line}`)];
          }
        }
      } catch {}
    }
    changes.push({ path: f.path, added, removed: 0, hunk });
  }
  return { diff, files, changes };
}
async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
function addLog(session, text) {
  session.logs = [...(session.logs ?? []), text].slice(-500);
  session.updatedAt = now();
}
function addMessage(session, role, text) {
  if (!text.trim()) return;
  const last = session.messages.at(-1);
  if (role === "agent" && last?.role === "agent" && now() - last.at < 1200) {
    last.text += text;
    last.at = now();
  } else session.messages.push({ id: id(), role, text, at: now() });
}
function parseAgentOutput(session, line) {
  addLog(session, line);
  const update = adapters[session.agentId].parse(line, session);
  if (update.text) addMessage(session, "agent", update.text);
  if (update.error) addMessage(session, "system", update.error);
}
function agentCommand(session, project, prompt, continuing) {
  const adapter = adapters[session.agentId];
  return adapter.command({
    projectPath: project.path,
    prompt,
    session,
    continuing,
    dataDir: DATA_DIR,
    provider: state.agents.find((a) => a.id === session.agentId)?.provider,
    model: session.model,
  });
}
async function buildManifest(session, project) {
  const agent = state.agents.find((a) => a.id === session.agentId);
  const trackedFiles = await git(project, ["ls-files", "-co", "--exclude-standard"]);
  const files = trackedFiles.stdout.split(/\r?\n/).filter(Boolean).slice(0, 400);
  const candidates = files.filter((file) =>
    /(readme|package\.json|src|app|lib|components|routes|pages|server|api|test|spec)/i.test(file),
  );
  return {
    createdAt: now(),
    project: { id: project.id, name: project.name, path: project.path, branch: project.branch },
    task: session.request,
    ...(session.criteria ? { acceptanceCriteria: session.criteria } : {}),
    agent: {
      id: session.agentId,
      account: agent?.account ?? null,
      model: session.model ?? "agent default",
    },
    constraints: [
      "Work only within the project directory",
      "No deployments, publishing, or external/shared-system changes without the user",
      "Do not revert or overwrite user changes",
    ],
    relevantFiles: candidates.slice(0, 60),
    tools: agent?.tools ?? "agent's default CLI tools",
    dirtyWorktree: (project.uncommittedFiles ?? []).length > 0,
  };
}
async function runAgent(session, prompt, continuing = false) {
  const project = state.projects.find((p) => p.id === session.projectId);
  if (!project) return;
  const meta = state.agents.find((a) => a.id === session.agentId);
  if (!meta?.installed || !meta.signedIn) {
    session.status = "blocked";
    addMessage(
      session,
      "system",
      `${meta?.name ?? session.agentId} is not available or not authenticated. Check the Agents page.`,
    );
    await save();
    return;
  }
  session.status = "working";
  await save();
  await projectInfo(project);
  session.manifest = await buildManifest(session, project);
  addLog(
    session,
    `Context manifest: ${session.manifest.relevantFiles.length} candidate files, tools: ${session.manifest.tools}`,
  );
  const manifestLine =
    `Context manifest: project ${project.name} (${project.branch}); task: ${session.request}` +
    (session.criteria ? `; acceptance criteria: ${session.criteria}` : "") +
    `; model: ${session.model ?? "agent default"}` +
    `; constraints: ${session.manifest.constraints.join("; ")}; candidate files: ${session.manifest.relevantFiles.join(", ") || "(none listed)"}`;
  const safetyPreamble =
    "Safety instructions: Work only in this project. Do not deploy, publish, send external communications, modify shared or production systems, or delete data. If such an action is necessary, stop and ask the user instead. Preserve existing files unless the requested code change requires editing them. ";
  const [bin, args] = agentCommand(
    session,
    project,
    `${safetyPreamble}${manifestLine}\n\nTask: ${prompt}`,
    continuing,
  );
  if (session.agentId === "pi")
    await fs.mkdir(path.join(DATA_DIR, "sessions"), { recursive: true, mode: 0o700 });
  const child = spawn(bin, args, {
    cwd: project.path,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });
  session.pid = child.pid;
  children.set(session.id, child);
  await save();
  let stdoutBuffer = "",
    stderrBuffer = "";
  const consume = (data, isErr = false) => {
    if (isErr) {
      const text = data.toString();
      stderrBuffer += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      session.logs = [...session.logs, ...lines].slice(-500);
      for (const line of lines) {
        const permission = line.match(/permission requested: (.*?); auto-rejecting/i);
        if (permission)
          addMessage(
            session,
            "system",
            `OpenCode requested permission for ${permission[1]}; its non-interactive CLI rejected the request. ADE did not approve or run that action.`,
          );
      }
      session.updatedAt = now();
      return;
    }
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) parseAgentOutput(session, line);
  };
  child.stdout.on("data", (d) => consume(d));
  child.stderr.on("data", (d) => consume(d, true));
  child.on("error", async (error) => {
    children.delete(session.id);
    delete session.pid;
    session.status = "blocked";
    addMessage(session, "system", `${bin} failed to start: ${error.message}`);
    await save();
  });
  child.on("close", async (code, signal) => {
    if (stdoutBuffer.trim()) parseAgentOutput(session, stdoutBuffer);
    children.delete(session.id);
    delete session.pid;
    if (session.status === "stopped") {
      session.workingTreeSnapshot = await snapshotDigest(project);
      await save();
      return;
    }
    const queue = session.queuedMessages ?? [];
    session.queuedMessages = [];
    if (queue.length) {
      await save();
      return runAgent(session, queue.join("\n\n"), true);
    }
    session.status = code === 0 ? "ready" : "blocked";
    const failureTexts = [
      ...session.messages.filter((m) => m.role === "system").map((m) => m.text),
      session.logs,
    ];
    const failureKind = code === 0 ? undefined : classifyFailure(failureTexts);
    if (failureKind && failureKind !== "process") session.failureKind = failureKind;
    if (code === 0 && !session.messages.some((m) => m.role === "agent"))
      addMessage(
        session,
        "system",
        "The CLI exited successfully but did not emit a parseable response. Review the Logs tab for its raw output.",
      );
    if (code !== 0) {
      const modelNote = session.model ? ` The selected model was "${session.model}".` : "";
      const suggestion = failureKind === "model_not_found" ? modelSuggestion(failureTexts) : "";
      addMessage(
        session,
        "system",
        failureKind === "provider_quota"
          ? `Provider quota or rate limit reached — no work was performed.${retryHint(session.logs) ? ` ${retryHint(session.logs)}.` : ""} Your task is kept; nothing in the project was changed. Retry later or switch agents.`
          : failureKind === "model_not_found"
            ? `The agent rejected the selected model — no work was performed.${modelNote}${suggestion ? ` ${suggestion}` : ""} Pick a different model with Change model, or clear it to use the agent's configured default, then send a follow-up. Nothing in the project was changed; your task is kept.`
            : failureKind === "provider_unavailable"
              ? `The agent reported that its provider is unavailable — no work was performed.${modelNote} Check this CLI's own provider setup (Agents page); ADE does not manage provider credentials. Nothing in the project was changed.`
              : failureKind === "auth_expired"
                ? `The agent's sign-in or credentials were refused — no work was performed. Re-authenticate with this CLI's own sign-in flow from the Agents page, then retry. Nothing in the project was changed; your task is kept.`
                : failureKind === "context_overflow"
                  ? `The conversation exceeded the model's context window and the turn stopped. Shorten or summarize your follow-up (or start a fresh session for a narrower task); a larger-context model may also help — use Change model. Any project edits made before the failure were left in place.`
                  : `Agent process exited with ${signal ?? `code ${code}`}. Existing project changes were left in place. See Logs for details.`,
      );
    }
    session.summary = session.messages.filter((m) => m.role === "agent").at(-1)?.text;
    session.updatedAt = now();
    session.workingTreeSnapshot = await snapshotDigest(project);
    session.checks = [
      {
        name: "Project checks",
        status: "not_run",
        detail: "No checks were run automatically. Run them explicitly from the Checks tab.",
      },
    ];
    await save();
  });
  await save();
}
function stopChild(child) {
  const pid = typeof child === "number" ? child : child?.pid;
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
    else if (typeof child === "number") process.kill(pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try {
      if (typeof child === "number") process.kill(pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }
}
function spawnProcess(proc, project) {
  const child = spawn(proc.bin, proc.args, {
    cwd: project.path,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });
  proc.pid = child.pid;
  proc.status = "running";
  proc.startedAt = now();
  proc.output = [`$ ${proc.command}`];
  children.set(proc.id, child);
  const line = (data) => {
    proc.output = [...proc.output, ...data.toString().split(/\r?\n/).filter(Boolean)].slice(-300);
    proc.updatedAt = now();
    save().catch(() => {});
  };
  child.stdout.on("data", line);
  child.stderr.on("data", line);
  child.on("error", (e) => {
    proc.status = "stopped";
    delete proc.pid;
    proc.output.push(e.message);
    children.delete(proc.id);
    save().catch(() => {});
  });
  child.on("close", (code) => {
    proc.status = "stopped";
    delete proc.pid;
    proc.exitCode = code;
    proc.output.push(`Process exited (${code ?? "signal"})`);
    children.delete(proc.id);
    save().catch(() => {});
  });
  return proc;
}
async function packageManager(project, pkg = {}) {
  const declared = String(pkg.packageManager ?? "").split("@")[0];
  if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  for (const [lock, manager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ]) {
    if (
      await fs
        .access(path.join(project.path, lock))
        .then(() => true)
        .catch(() => false)
    )
      return manager;
  }
  return "npm";
}
async function checksFor(project) {
  const categories = [
    { name: "Typecheck", scripts: ["typecheck", "type-check", "check"] },
    { name: "Lint", scripts: ["lint"] },
    { name: "Unit tests", scripts: ["test"] },
    { name: "End-to-end", scripts: ["test:e2e", "e2e"] },
    { name: "Build", scripts: ["build"] },
  ];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    const manager = await packageManager(project, pkg);
    return categories.map((category) => {
      const script = category.scripts.find((name) => scripts[name]);
      return script
        ? {
            name: category.name,
            script,
            command: `${manager} run ${script}`,
            status: "not_run",
            detail: "Not run",
          }
        : {
            name: category.name,
            status: "skipped",
            detail: `No ${category.scripts.join(" or ")} script configured.`,
          };
    });
  } catch {
    return categories.map(({ name }) => ({
      name,
      status: "skipped",
      detail: "No package.json scripts detected.",
    }));
  }
}
async function executeChecks(session) {
  const project = state.projects.find((p) => p.id === session.projectId);
  const checks = await checksFor(project);
  session.status = "verifying";
  session.checks = checks.filter((check) => !check.script);
  const pkg = JSON.parse(
    await fs.readFile(path.join(project.path, "package.json"), "utf8").catch(() => "{}"),
  );
  const manager = await packageManager(project, pkg);
  for (const check of checks.filter((item) => item.script)) {
    const actualCmd = `${manager} run ${check.script}`;
    const r = await run(manager, ["run", check.script], { cwd: project.path, timeout: 120000 });
    const output = (r.stdout + r.stderr).trim().slice(-4000);
    session.checks.push({
      name: check.name,
      status: r.code === 0 ? "passed" : "failed",
      detail: `${actualCmd} · exit ${r.code}\n${output}`,
    });
    session.logs.push(`$ ${actualCmd}\n${output}`);
    await save();
  }
  session.status = "ready";
  session.updatedAt = now();
  await save();
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}
function localRequest(req) {
  const host = req.headers.host?.split(":")[0];
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  return true;
}
async function handle(req, res) {
  if (!localRequest(req))
    return json(res, 403, { error: "ADE local API only accepts requests from this machine." });
  const url = new URL(req.url, "http://127.0.0.1");
  const parts = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  try {
    if (req.method === "GET" && parts[0] === "bootstrap") {
      const agents = await agentStatus();
      for (const p of state.projects) {
        await projectInfo(p);
        const diff = await getDiff(p);
        for (const s of state.sessions.filter(
          (item) => item.projectId === p.id && item.status !== "complete",
        ))
          s.changes = diff.changes;
      }
      return json(res, 200, {
        projects: state.projects.map(safeProject),
        sessions: state.sessions,
        processes: state.processes,
        agents,
        now: now(),
      });
    }
    if (req.method === "GET" && parts[0] === "pick-folder") {
      const choices =
        process.platform === "darwin"
          ? [["osascript", ["-e", "POSIX path of (choose folder)"]]]
          : process.platform === "win32"
            ? [
                [
                  "powershell",
                  [
                    "-NoProfile",
                    "-Command",
                    "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}",
                  ],
                ],
              ]
            : [
                [
                  "zenity",
                  ["--file-selection", "--directory", "--title=Choose a project folder for ADE"],
                ],
                ["kdialog", ["--getexistingdirectory", os.homedir()]],
              ];
      for (const [bin, args] of choices) {
        const picked = await run(bin, args, { timeout: 120000 });
        if (picked.code === 0 && picked.stdout.trim())
          return json(res, 200, { path: picked.stdout.trim() });
        if (process.platform !== "linux") break;
      }
      return json(res, 501, {
        error:
          "No supported native folder picker was found. Enter the absolute local folder path instead.",
      });
    }
    if (req.method === "POST" && parts[0] === "projects" && parts.length === 1) {
      const data = await body(req);
      const requested = String(data.path ?? "").trim();
      if (!requested) return json(res, 400, { error: "Choose a local folder path." });
      const expanded = requested.startsWith("~")
        ? path.join(os.homedir(), requested.slice(1))
        : path.resolve(requested);
      const real = await fs.realpath(expanded);
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) return json(res, 400, { error: "That path is not a directory." });
      if (state.projects.some((p) => p.path === real))
        return json(res, 409, { error: "This project is already added." });
      const project = {
        id: id(),
        name: String(data.name || path.basename(real)),
        path: real,
        branch: "",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: now(),
      };
      await projectInfo(project);
      state.projects.push(project);
      const pkg = JSON.parse(
        await fs.readFile(path.join(real, "package.json"), "utf8").catch(() => "{}"),
      );
      const manager = await packageManager(project, pkg);
      const devCommand = pkg.scripts?.dev ? `${manager} run dev` : "";
      const proc = devCommand
        ? {
            id: id(),
            projectId: project.id,
            name: "Development server",
            command: devCommand,
            bin: devCommand.split(" ")[0],
            args: devCommand.split(" ").slice(1),
            port: 0,
            status: "stopped",
            output: [],
          }
        : null;
      if (proc) state.processes.push(proc);
      await save();
      return json(res, 201, { project, process: proc });
    }
    if (req.method === "POST" && parts[0] === "projects" && parts[2] === "default-agent") {
      const project = state.projects.find((p) => p.id === parts[1]);
      const data = await body(req);
      if (!project || !["codex", "opencode", "pi"].includes(data.agentId))
        return json(res, 400, { error: "Choose a supported agent and project." });
      project.defaultAgent = data.agentId;
      await save();
      return json(res, 200, project);
    }
    if (req.method === "POST" && parts[0] === "projects" && parts[2] === "remove") {
      const idx = state.projects.findIndex((p) => p.id === parts[1]);
      if (idx === -1) return json(res, 404, { error: "Project not found." });
      const busy =
        state.sessions.some((s) => s.projectId === parts[1] && children.has(s.id)) ||
        state.processes.some((x) => x.projectId === parts[1] && children.has(x.id));
      if (busy)
        return json(res, 409, {
          error: "Stop the running agent or dev process before removing this project.",
        });
      for (const p of state.processes.filter((x) => x.projectId === parts[1]))
        stopChild(children.get(p.id));
      state.projects.splice(idx, 1);
      state.sessions = state.sessions.filter((s) => s.projectId !== parts[1]);
      state.processes = state.processes.filter((x) => x.projectId !== parts[1]);
      await save();
      return json(res, 200, {
        removed: parts[1],
        note: "Only ADE metadata was removed. The project folder and its files were not touched.",
      });
    }
    if (req.method === "GET" && parts[0] === "projects" && parts[2] === "diff") {
      const project = state.projects.find((p) => p.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      return json(res, 200, await getDiff(project));
    }
    if (req.method === "GET" && parts[0] === "projects" && parts[2] === "checks") {
      const project = state.projects.find((p) => p.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      return json(res, 200, { checks: await checksFor(project) });
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts.length === 1) {
      const data = await body(req);
      // Sanitize the optional model before anything else so a malformed id is
      // refused with an honest 400 without ever spawning a CLI.
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was started.",
        });
      const project = state.projects.find((p) => p.id === data.projectId);
      const agent = state.agents.find((a) => a.id === data.agentId);
      if (!project || !agent) return json(res, 400, { error: "Select a valid project and agent." });
      if (!agent.installed || !agent.signedIn)
        return json(res, 400, {
          error: `${agent.name} must be installed and authenticated using its supported sign-in flow first.`,
        });
      const request = String(data.request ?? "").trim();
      if (request.length < 4)
        return json(res, 400, { error: "Describe the task in at least four characters." });
      if (UNSUPPORTED_RISK.test(`${request} ${data.criteria ?? ""}`))
        return json(res, 403, {
          error:
            "This request appears to require a destructive or external action. ADE cannot mediate this CLI's per-action approval flow yet, so it will not start it. Use the agent CLI directly after reviewing the action's scope.",
        });
      await projectInfo(project);
      if (project.uncommittedFiles.length)
        return json(res, 409, {
          error: `This project has uncommitted changes (${project.uncommittedFiles.slice(0, 5).join(", ")}). Commit or stash them first. ADE will not start an agent against a dirty working tree.`,
        });
      if (
        state.sessions.some(
          (s) => s.projectId === project.id && ["working", "verifying"].includes(s.status),
        )
      )
        return json(res, 409, {
          error:
            "Another agent task is still running in this project. Wait until it stops before starting another.",
        });
      const s = {
        id: id(),
        projectId: project.id,
        agentId: agent.id,
        createdBy: agent.id,
        request,
        criteria: String(data.criteria ?? ""),
        status: "working",
        messages: [
          {
            id: id(),
            role: "user",
            text: request + (data.criteria ? `\n\nAcceptance criteria: ${data.criteria}` : ""),
            at: now(),
          },
        ],
        changes: [],
        checks: [{ name: "Project checks", status: "not_run", detail: "Not run yet." }],
        logs: [],
        createdAt: now(),
        updatedAt: now(),
        queuedMessages: [],
        ...(model ? { model } : {}),
      };
      state.sessions.unshift(s);
      await save();
      runAgent(s, request + (data.criteria ? `\n\nAcceptance criteria: ${data.criteria}` : ""));
      return json(res, 201, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "messages") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const text = String((await body(req)).text ?? "").trim();
      if (!text) return json(res, 400, { error: "Message cannot be empty." });
      if (UNSUPPORTED_RISK.test(text))
        return json(res, 403, {
          error:
            "ADE cannot mediate this destructive or external action's approval flow yet; the message was not sent.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before sending a message." });
      const project = state.projects.find((p) => p.id === s.projectId);
      if (
        !children.has(s.id) &&
        s.workingTreeSnapshot &&
        (await snapshotDigest(project)) !== s.workingTreeSnapshot
      )
        return json(res, 409, {
          error:
            "The project working tree changed since this agent turn. Review those edits before sending another turn; ADE will not overwrite or reset them.",
        });
      if (children.has(s.id)) {
        (s.queuedMessages ??= []).push(text);
        addMessage(s, "user", text);
        addLog(s, "Follow-up queued until the current CLI turn exits.");
      } else {
        addMessage(s, "user", text);
        s.queuedMessages = [text];
      }
      s.status = "working";
      await save();
      if (!children.has(s.id)) {
        s.queuedMessages = [];
        runAgent(s, text, true);
      }
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "switch-agent") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      const target = state.agents.find((a) => a.id === data.agentId);
      const project = state.projects.find((p) => p.id === s.projectId);
      if (!target?.installed || !target.signedIn)
        return json(res, 400, {
          error: `${target?.name ?? data.agentId} must be installed and authenticated before switching.`,
        });
      if (!project) return json(res, 404, { error: "Project not found." });
      if (children.has(s.id))
        return json(res, 409, {
          error: "Stop or wait for the current CLI turn to finish before switching agents.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before switching agents." });
      await projectInfo(project);
      if (project.uncommittedFiles.length)
        return json(res, 409, {
          error: "Commit or stash the working tree before switching agents.",
        });
      const from = state.agents.find((a) => a.id === s.agentId);
      s.createdBy = s.agentId;
      s.agentId = target.id;
      s.agentSessionId = undefined;
      // Model ids belong to one CLI's catalog; never transplant them across
      // agents. The new CLI starts on its own configured default.
      const droppedModel = s.model;
      delete s.model;
      const carriesConversation = false;
      addMessage(
        s,
        "system",
        `Switched from ${from?.name ?? s.agentId} to ${target.name}. The new CLI starts fresh: repository state, the task, and the current diff carry over, but the prior conversation does not.` +
          (droppedModel
            ? ` The selected model (${droppedModel}) belonged to the previous agent and was dropped; ${target.name} starts with its own configured default.`
            : " The model resets to the new agent's configured default."),
      );
      addLog(
        s,
        `agent switch: ${from?.short ?? s.agentId} → ${target.short} (conversation not carried)`,
      );
      s.status = "working";
      await save();
      runAgent(
        s,
        `A different coding agent worked on this task before you. Review the current repository state and continue or finish the task. Original request: ${s.request}${s.criteria ? `\nAcceptance criteria: ${s.criteria}` : ""}`,
      );
      return json(res, 200, { ...s, carriesConversation });
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "stop") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      s.status = "stopped";
      const child = children.get(s.id);
      stopChild(child ?? s.pid);
      addLog(s, "Stopped by user. Existing worktree changes are kept.");
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "complete") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s || !["ready", "blocked", "stopped"].includes(s.status))
        return json(res, 409, {
          error: "Wait for the agent to stop before completing this session.",
        });
      s.status = "complete";
      s.completedAt = now();
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "reopen") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      s.status = "ready";
      s.completedAt = undefined;
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "checks") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      if (children.has(s.id))
        return json(res, 409, { error: "Stop or wait for the agent before running checks." });
      await executeChecks(s);
      return json(res, 200, s);
    }
    if (req.method === "GET" && parts[0] === "sessions" && parts[2] === "diff") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      const p = state.projects.find((x) => x.id === s?.projectId);
      if (!p) return json(res, 404, { error: "Session not found." });
      return json(res, 200, await getDiff(p));
    }
    if (req.method === "POST" && parts[0] === "processes" && parts[2] === "start") {
      const proc = state.processes.find((x) => x.id === parts[1]);
      const project = state.projects.find((x) => x.id === proc?.projectId);
      if (!proc || !project) return json(res, 404, { error: "Process not found." });
      if (proc.status === "running") return json(res, 200, proc);
      proc.port = await allocatePort();
      proc.args = [
        ...proc.args.filter((a) => a !== "--host" && a !== "127.0.0.1" && a !== "--port"),
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        String(proc.port),
      ];
      spawnProcess(proc, project);
      await save();
      return json(res, 200, proc);
    }
    if (req.method === "POST" && parts[0] === "processes" && parts[2] === "stop") {
      const proc = state.processes.find((x) => x.id === parts[1]);
      if (!proc) return json(res, 404, { error: "Process not found." });
      stopChild(children.get(proc.id) ?? proc.pid);
      proc.status = "stopped";
      delete proc.pid;
      proc.updatedAt = now();
      await save();
      return json(res, 200, proc);
    }
    if (req.method === "POST" && parts[0] === "agents" && parts[2] === "login") {
      const agent = state.agents.find((a) => a.id === parts[1]);
      if (!agent?.installed) return json(res, 400, { error: "Install this CLI first." });
      if (agent.id !== "codex")
        return json(res, 400, {
          error:
            agent.id === "opencode"
              ? "OpenCode's provider chooser is interactive and has no stable non-interactive OAuth API. Run `opencode auth login` in a terminal; credentials are kept in OpenCode's user-level store."
              : "Pi's supported sign-in is the interactive /login command inside Pi. Run `pi`, then choose /login. ADE does not collect or store provider credentials.",
        });
      const existing = authChildren.get(agent.id);
      if (existing) return json(res, 200, { output: existing.output, running: true });
      const child = spawn("codex", ["login", "--device-auth"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      const job = { output: "", running: true };
      authChildren.set(agent.id, job);
      const collect = (d) => {
        job.output += d.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("close", async (code) => {
        job.running = false;
        job.code = code;
        await agentStatus();
      });
      return json(res, 200, { output: job.output, running: true });
    }
    if (req.method === "GET" && parts[0] === "agents" && parts[2] === "login") {
      const job = authChildren.get(parts[1]);
      return json(res, 200, {
        ...(job ?? { output: "", running: false }),
        agent: state.agents.find((a) => a.id === parts[1]),
      });
    }
    if (req.method === "GET" && parts[0] === "agents" && parts[2] === "models") {
      const agentId = parts[1];
      if (!adapters[agentId])
        return json(res, 404, { error: "Unknown agent. Available: codex, opencode, pi." });
      // Probes the CLI's own quota-free listing. The cache key includes the
      // CLI version reported by the bootstrap status poll so an upgraded
      // binary is never served a stale catalog.
      const version = state.agents.find((a) => a.id === agentId)?.version ?? "";
      return json(res, 200, await listModels(agentId, run, { version, cacheDir: DATA_DIR }));
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "model") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      // Same sanitize as session creation. "" or null clears back to the
      // agent's own configured default (an absent field means default).
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before changing its model." });
      // OpenCode's proven set-override pattern: only rewrite when the value
      // actually differs; applying at the next turn is inherent because
      // runAgent reads session.model when it spawns the CLI.
      const previousModel = s.model ?? null;
      const changed = previousModel !== (model || null);
      if (changed) {
        if (model) s.model = model;
        else delete s.model;
        addMessage(
          s,
          "system",
          model
            ? `Model set to "${model}". It applies from the next CLI turn; a turn already running keeps its current model. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified; the CLI may treat context differently under the new model.`
            : `Model cleared; the next turn uses ${s.agentId}'s configured default. A turn already running keeps its current model.`,
        );
        s.updatedAt = now();
        await save();
      }
      // Accepted even while a turn runs: it takes effect on the next turn.
      // The response reports both the old and new effective values.
      return json(res, 200, { ...s, model: s.model ?? null, previousModel });
    }
    if (req.method === "GET" && parts[0] === "agents")
      return json(res, 200, { agents: await agentStatus() });
    return json(res, 404, { error: "Not found." });
  } catch (error) {
    return json(res, 500, { error: error?.message ?? String(error) });
  }
}
await load();
export async function handleLocalApi(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return undefined;
  const headers = Object.fromEntries(request.headers.entries());
  const payload = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const req = {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value ?? "";
    },
  };
  await handle(req, response);
  return new Response(response.body, { status: response.statusCode, headers: response.headers });
}
export function adeLocalApi() {
  return {
    name: "ade-loopback-local-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        handle(req, res).catch((e) => json(res, 500, { error: e.message }));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api", (req, res) => {
        handle(req, res).catch((e) => json(res, 500, { error: e.message }));
      });
    },
  };
}
