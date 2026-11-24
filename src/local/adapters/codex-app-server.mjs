// A Codex turn over `codex app-server`, the JSON-RPC interface Codex's own editor extension
// uses. `codex exec` prints a reply only once it is finished; this one streams it. What it
// reports is logged as the events `codex exec --json` prints, so Activity reads either.
import { stopProcess } from "../spawn.mjs";
import { createRpc } from "../acp.mjs";
import { lines, exited } from "./kit.mjs";
import { createReplyStream } from "./reply-stream.mjs";

/** Opening a conversation also starts its MCP servers, which are given 30 seconds each. */
const START_MS = 90_000;
const METHOD_NOT_FOUND = -32601;

/** The app server could not take the turn and nothing was sent to the model. */
export class AppServerUnavailable extends Error {
  /** @param {string} message @param {boolean} unsupported this Codex has no such server */
  constructor(message, unsupported) {
    super(message);
    this.unsupported = unsupported;
  }
}

/** ADE permission to what Codex is asked for, and the sandbox it must then report. */
const ACCESS = {
  plan: { sandbox: "read-only", approvalPolicy: "never", reports: "readOnly" },
  build: { sandbox: "workspace-write", approvalPolicy: "never", reports: "workspaceWrite" },
  approve: {
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    reports: "workspaceWrite",
  },
  full: { sandbox: "danger-full-access", approvalPolicy: "never", reports: "dangerFullAccess" },
};

const snake = (name) => String(name).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** A thread item as `codex exec --json` prints it, or null for one it does not print. */
export function execItem(item) {
  if (!item || ["userMessage", "hookPrompt"].includes(item.type)) return null;
  const status = item.status === "declined" ? "failed" : item.status && snake(item.status);
  const base = { id: item.id, type: snake(item.type), ...(status ? { status } : {}) };
  switch (item.type) {
    case "agentMessage":
    case "plan":
      return { ...base, text: item.text ?? "" };
    case "commandExecution":
      return {
        ...base,
        command: item.command,
        aggregated_output: item.aggregatedOutput ?? "",
        exit_code: item.exitCode ?? null,
      };
    case "fileChange":
      return {
        ...base,
        changes: (item.changes ?? []).map((change) => ({
          path: change.path,
          kind: change.kind?.type ?? change.kind,
        })),
      };
    case "mcpToolCall":
      return {
        ...base,
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result,
        error: item.error,
      };
    case "webSearch":
      return { ...base, query: item.query ?? "" };
    default:
      return base;
  }
}

/** Answers Codex's requests. ADE's Codex turns run unattended, so nothing is approved here. */
async function decline(method) {
  if (method === "item/commandExecution/requestApproval") return { decision: "decline" };
  if (method === "item/fileChange/requestApproval") return { decision: "decline" };
  if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
  if (method === "mcpServer/elicitation/request")
    return { action: "decline", content: null, _meta: null };
  throw Object.assign(new Error(`ADE does not implement ${method}.`), { code: METHOD_NOT_FOUND });
}

/**
 * @param {import("./kit.mjs").TurnInput} input
 * @param {import("./kit.mjs").TurnIO} io
 * @param {{ args: string[], env: Record<string, string> }} launch `-c` overrides and spawn env
 * @returns {Promise<import("./kit.mjs").TurnEnd>}
 * @throws {AppServerUnavailable} before the prompt was sent
 */
export async function runCodexAppServerTurn(input, io, { args, env }) {
  const access = ACCESS[input.permission ?? "build"] ?? ACCESS.build;
  const child = io.spawn("codex", ["app-server", ...args], { env, stdin: "pipe" });
  const log = (event) => io.emit({ type: "log", line: JSON.stringify(event) });
  const reply = createReplyStream();
  let threadId = "";
  let initialized = false;
  let usage;
  /** @type {(turn: any) => void} */
  let finish = () => {};
  const finished = new Promise((resolve) => (finish = resolve));
  const forward = (events) => events.forEach((event) => io.emit(event));

  const onNotification = (method, params) => {
    // Sub-agents report on threads of their own; only this conversation is shown.
    if (!threadId || params?.threadId !== threadId) return;
    if (method === "item/agentMessage/delta") forward(reply.delta(String(params.delta ?? "")));
    else if (method === "item/started" || method === "item/completed") {
      const item = execItem(params.item);
      if (!item) return;
      const done = method === "item/completed";
      if (item.type === "agent_message") {
        if (done) forward(reply.end(String(params.item.text ?? "")));
        else reply.begin();
      }
      log({ type: done ? "item.completed" : "item.started", item });
    } else if (method === "turn/started") log({ type: "turn.started" });
    else if (method === "turn/plan/updated")
      log({
        type: "item.completed",
        item: {
          id: "plan",
          type: "todo_list",
          items: (params.plan ?? []).map((step) => ({
            text: step.step,
            completed: step.status === "completed",
          })),
        },
      });
    else if (method === "thread/tokenUsage/updated") usage = params.tokenUsage?.last;
    else if (method === "warning")
      log({ type: "item.completed", item: { type: "error", message: params.message } });
    else if (method === "error" && params.willRetry)
      log({ type: "item.completed", item: { type: "error", message: params.error?.message } });
    else if (method === "turn/completed") finish(params.turn);
  };
  const rpc = createRpc(child.stdout, child.stdin, {
    onNotification(method, params) {
      try {
        onNotification(method, params);
      } catch {
        /* an update ADE cannot read is worth less than the turn */
      }
    },
    onRequest: decline,
    onInvalid: (line) => io.emit({ type: "log", line }),
  });
  const stderr = lines((line) => io.emit({ type: "log", line }));
  child.stderr?.on("data", stderr.push);
  const exit = exited(child);
  void exit.then((result) => {
    const reason = result.error?.message ?? `exited (${result.signal ?? `code ${result.code}`})`;
    rpc.close(new Error(`codex app-server ${reason}`));
    finish(null);
  });

  /** The server closes when its input does; a lingering one is stopped. */
  const close = async () => {
    child.stdin?.end();
    const linger = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) stopProcess(child);
    }, 3000);
    linger.unref?.();
    const result = await exit;
    clearTimeout(linger);
    stderr.flush();
    return result;
  };

  try {
    const timer = setTimeout(() => stopProcess(child), START_MS);
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "ade", title: "ADE", version: "1" },
      });
      initialized = true;
      rpc.notify("initialized", {});
      const settings = {
        cwd: input.projectPath,
        sandbox: access.sandbox,
        approvalPolicy: access.approvalPolicy,
        ...(access.approvalsReviewer ? { approvalsReviewer: access.approvalsReviewer } : {}),
        ...(input.model ? { model: input.model } : {}),
      };
      const resume = input.continuing && input.session.agentSessionId;
      const opened = resume
        ? await rpc.request("thread/resume", { ...settings, threadId: resume, excludeTurns: true })
        : await rpc.request("thread/start", settings);
      if (typeof opened?.thread?.id !== "string") throw new Error("no thread id was returned");
      // Never run with other access than the user chose, whatever the configuration says.
      if (
        opened.sandbox?.type !== access.reports ||
        opened.approvalPolicy !== access.approvalPolicy
      )
        throw new Error("it did not apply the selected permissions");
      threadId = opened.thread.id;
      io.emit({ type: "conversation", id: threadId });
      log({ type: "thread.started", thread_id: threadId });
      await rpc.request("turn/start", {
        threadId,
        ...(input.effort ? { effort: input.effort } : {}),
        input: [
          { type: "text", text: input.prompt, text_elements: [] },
          ...input.attachments
            .filter((file) => file.kind === "image")
            .map((file) => ({ type: "localImage", path: file.path })),
        ],
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    await close();
    if (io.signal.aborted) return { ok: false, reason: "unfinished" };
    throw new AppServerUnavailable(
      error instanceof Error ? error.message : String(error),
      !initialized || /** @type {any} */ (error)?.code === METHOD_NOT_FOUND,
    );
  }
  const turn = await finished;
  const result = await close();
  if (!turn) {
    if (io.signal.aborted) return { ok: false, reason: "unfinished" };
    return { ok: false, reason: "exit", exit: { code: result.code, signal: result.signal } };
  }
  if (turn.status === "completed") {
    log({ type: "turn.completed", ...(usage ? { usage } : {}) });
    return { ok: true };
  }
  if (turn.status === "failed") {
    const message = [turn.error?.message, turn.error?.additionalDetails].filter(Boolean).join(" ");
    log({ type: "turn.failed", error: { message } });
    io.emit({ type: "error", text: message || "Codex reported an error." });
    return { ok: false, reason: "reported" };
  }
  return { ok: false, reason: "unfinished" };
}
