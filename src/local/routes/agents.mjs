import { spawnCommand as spawn } from "../spawn.mjs";
import { adapters } from "../adapters/index.mjs";
import { optionCapabilities } from "../capabilities.mjs";
import { miseUpdateCommand } from "../harness.mjs";
import { brewUpdateCommand } from "../harness-brew.mjs";

/** `/api/agents/*`: sign-in, install and update jobs, models and option capabilities. */
export async function agents(ctx) {
  const {
    req,
    res,
    url,
    parts,
    state,
    authChildren,
    harnessJobs,
    turns,
    agentStatus,
    listAgentModels,
    json,
  } = ctx;
  if (req.method === "POST" && parts[0] === "agents" && parts[2] === "login") {
    const agent = state.agents.find((a) => a.id === parts[1]);
    if (!agent?.installed) return json(res, 400, { error: "Install this CLI first." });
    // ADE starts only a sign-in the agent offers as a device flow; any
    // other sign-in happens in the agent's own terminal UI.
    const signIn = adapters[agent.id]?.signIn;
    if (!signIn?.device)
      return json(res, 400, {
        error: `${signIn?.note ?? `${agent.name} signs in from its own CLI.`}${signIn?.command ? ` Run \`${signIn.command}\` in a terminal.` : ""}`,
      });
    const existing = authChildren.get(agent.id);
    if (existing) return json(res, 200, { output: existing.output, running: true });
    const child = spawn(signIn.device[0], signIn.device[1], {
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
      return json(res, 404, {
        error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
      });
    // Probes the CLI's own quota-free listing. The cache key includes the
    // CLI version reported by the bootstrap status poll so an upgraded
    // binary is never served a stale catalog.
    return json(res, 200, await listAgentModels(agentId));
  }
  if (req.method === "GET" && parts[0] === "agents" && parts[2] === "capabilities") {
    const agentId = parts[1];
    if (!adapters[agentId])
      return json(res, 404, {
        error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
      });
    const modelId = url.searchParams.get("model") || undefined;
    const listed = await listAgentModels(agentId);
    const modelRow =
      modelId && listed?.available
        ? (listed.models?.find((m) => m.id === modelId) ?? { id: modelId })
        : undefined;
    return json(res, 200, optionCapabilities(adapters[agentId], modelRow));
  }
  if (
    parts[0] === "agents" &&
    parts.length === 3 &&
    (parts[2] === "install" || parts[2] === "update" || parts[2] === "harness")
  ) {
    const agentId = parts[1];
    if (!adapters[agentId])
      return json(res, 404, {
        error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
      });
    const agent = state.agents.find((a) => a.id === agentId);
    if (req.method === "GET" && parts[2] === "harness") {
      const job = harnessJobs.get(agentId);
      return json(res, 200, { ...job, agentId, kind: job.kind ?? "install" });
    }
    if (req.method !== "POST" || (parts[2] !== "install" && parts[2] !== "update"))
      return json(res, 404, { error: "Not found." });
    const kind = parts[2];
    if (
      state.sessions.some(
        (s) =>
          s.agentId === agentId && (turns.isBusy(s) || ["working", "verifying"].includes(s.status)),
      )
    )
      return json(res, 409, {
        error:
          "This agent still has a running task. Wait until it stops before installing or updating.",
      });
    const method = agent?.installMethod ?? "missing";
    if (kind === "install" && method !== "missing")
      return json(res, 409, {
        error: `${agent?.name ?? agentId} is already installed.`,
      });
    if (kind === "update" && method !== "npm" && method !== "mise" && method !== "brew") {
      if (method === "other")
        return json(res, 409, {
          error: `Installed outside npm, mise, and Homebrew at ${agent?.installPath ?? "unknown path"}; update it where you installed it.`,
        });
      return json(res, 409, {
        error: `${agent?.name ?? agentId} is not installed yet. Install it first.`,
      });
    }
    try {
      const command =
        kind === "update" && method === "mise"
          ? miseUpdateCommand(adapters[agentId], agent?.miseTool)
          : kind === "update" && method === "brew"
            ? brewUpdateCommand(agent?.brewItem)
            : adapters[agentId].harness[kind];
      if (!command)
        return json(res, 409, {
          error: "Unable to verify how this agent is managed. Refresh agent status and try again.",
        });
      const job = harnessJobs.start(agentId, kind, command);
      return json(res, 200, job);
    } catch (error) {
      if (error?.code === "BUSY") return json(res, 409, { error: error.message });
      throw error;
    }
  }
  if (
    req.method === "POST" &&
    parts[0] === "agents" &&
    parts[1] === "check-updates" &&
    parts.length === 2
  ) {
    const checked = await agentStatus({ forceLatest: true });
    return json(res, 200, {
      failed: checked.filter((agent) => agent.latestCheckFailed).map((agent) => agent.name),
    });
  }
  if (req.method === "GET" && parts[0] === "agents")
    return json(res, 200, { agents: await agentStatus() });
  return ctx.handled || res.writableEnded;
}
