import { COMPUTER_ERROR_STATUS } from "../computer.mjs";
import { INCOGNITO_PROFILE_ID } from "../browser-contexts.mjs";
import { HumanControlError } from "../browser-control.mjs";
import { resolveAttachments } from "../attachments.mjs";
import { body, PayloadTooLarge } from "../http.mjs";

const OBSERVE_BROWSER_ACTIONS = new Set(["status", "snapshot", "screenshot", "wait_for"]);
const OBSERVE_COMPUTER_ACTIONS = new Set(["screenshot", "wait"]);

/** `/api/projects/:id/computer|browser/*`: the project's agent browser and its tools. */
export async function browser(ctx) {
  const {
    req,
    res,
    parts,
    DATA_DIR,
    state,
    browserContexts,
    controls,
    browserHub,
    computers,
    browserStream,
    save,
    computerView,
    json,
  } = ctx;
  if (parts[0] === "projects" && parts[2] === "computer") {
    const project = state.projects.find((x) => x.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    if (req.method === "GET" && parts.length === 3) return json(res, 200, computerView(project));
    if (req.method === "POST" && parts[3] === "start") {
      // Returns at once; the UI polls status through installing/starting.
      computers.start(project.id).catch(() => {});
      return json(res, 202, computerView(project));
    }
    if (req.method === "POST" && parts[3] === "stop") {
      await computers.stop(project.id);
      // The control lock belonged to the browser that just closed.
      await controls.delete(project.id);
      return json(res, 200, computerView(project));
    }
    if (req.method === "POST" && (parts[3] === "profile" || parts[3] === "clear")) {
      // Switch between the project's persistent profile and a throwaway incognito context,
      // or delete the persistent profile's cookies, storage and cache. Both restart the
      // browser if it was running.
      const input = parts[3] === "profile" ? await body(req) : {};
      const profile = input.profile === INCOGNITO_PROFILE_ID ? INCOGNITO_PROFILE_ID : "default";
      const changing = parts[3] === "clear" || (project.browserProfile ?? "default") !== profile;
      if (changing) {
        const wasRunning = computers.status(project.id).status === "running";
        await computers.stop(project.id);
        await controls.delete(project.id);
        if (parts[3] === "clear") await browserContexts.clearProfile(project.id);
        else {
          if (profile === "default") delete project.browserProfile;
          else project.browserProfile = profile;
          await save();
        }
        if (wasRunning) computers.start(project.id).catch(() => {});
      }
      return json(res, 200, computerView(project));
    }
    if (req.method === "POST" && parts[3] === "action") {
      // Agent tools (MCP server / Pi extension): starts the browser on first use, then runs
      // one screenshot/mouse/keyboard action on its page.
      try {
        const input = await body(req);
        const control = controls.for(project.id);
        const run = () => computers.action(project.id, input);
        const { status, payload } = OBSERVE_COMPUTER_ACTIONS.has(input.action)
          ? await control.observe(run)
          : await control.agent(run);
        return json(res, status, payload);
      } catch (error) {
        if (error instanceof PayloadTooLarge) throw error;
        const code = error?.code;
        return json(res, COMPUTER_ERROR_STATUS[code] ?? 503, {
          error: error?.message ?? String(error),
          ...(code ? { code } : {}),
        });
      }
    }
    if (req.method === "POST" && parts[3] === "control") {
      // Take or hand back control of the browser; shared with the browser stream.
      const input = await body(req);
      const viewer = String(input.viewer ?? "");
      if (!viewer) return json(res, 400, { error: "viewer is required." });
      const control = controls.for(project.id);
      try {
        if (input.action === "take") return json(res, 200, control.take(viewer));
        if (input.action === "release")
          return json(
            res,
            200,
            control.release(viewer, async () => {
              // BrowserSession owns the pressed-key and button records shared by every transport.
              await browserHub.peek(project.id)?.releaseInput();
            }),
          );
      } catch (error) {
        if (error instanceof HumanControlError || error?.code === "browser_closed")
          return json(res, COMPUTER_ERROR_STATUS[error.code] ?? 503, {
            error: error.message,
            code: error.code,
          });
        throw error;
      }
      return json(res, 400, { error: 'action must be "take" or "release".' });
    }
    return json(res, 404, { error: "Not found." });
  }
  if (parts[0] === "projects" && parts[2] === "browser") {
    const project = state.projects.find((x) => x.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    if (req.method === "GET" && parts.length === 3) {
      const computer = computers.status(project.id);
      const { owner, generation } = controls.for(project.id).state();
      const control = { owner, generation };
      if (computer.status !== "running") {
        const reason =
          computer.status === "stopped"
            ? "The agent browser is off. Start it to watch the agent work."
            : (computer.detail ?? "The agent browser is not running yet.");
        return json(res, 200, { available: false, reason, control });
      }
      // Origin-relative: the page resolves it against the address it was loaded
      // from, which is also correct behind an HTTPS proxy (wss:).
      return json(res, 200, {
        available: true,
        streamUrl: browserStream.url(project.id),
        control,
      });
    }
    if (req.method === "POST" && parts[3] === "action") {
      // Agent tools (browser_* in computer-tools-defs.mjs): one Playwright action.
      const input = await body(req);
      const name = String(input.action ?? "").replace(/^browser_/, "");
      const control = controls.for(project.id);
      const run = () => browserHub.get(project.id).then((s) => s.runAgentAction(input));
      try {
        const result = OBSERVE_BROWSER_ACTIONS.has(name)
          ? await control.observe(run)
          : await control.agent(run);
        return json(res, 200, result);
      } catch (error) {
        const code = error?.code;
        return json(res, COMPUTER_ERROR_STATUS[code] ?? 500, {
          error: error?.message ?? String(error),
          ...(code ? { code } : {}),
        });
      }
    }
    if (req.method === "POST" && parts[3] === "file-chooser") {
      // The viewer in control answers the page's file picker with files it uploaded through
      // /api/attachments. No attachments closes the picker without a file.
      const input = await body(req);
      const viewer = String(input.viewer ?? "");
      const chooserId = String(input.chooserId ?? "");
      if (!viewer || !chooserId)
        return json(res, 400, { error: "viewer and chooserId are required." });
      const session = browserHub.peek(project.id);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const ids = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];
        const files = (await resolveAttachments(DATA_DIR, ids)).map((file) => ({
          name: file.name,
          mimeType: file.mime,
          buffer: file.bytes,
        }));
        const answered = await controls
          .for(project.id)
          .human(viewer, () => session.answerFileChooser(chooserId, files));
        if (!answered)
          return json(res, 409, {
            error: "That file picker is no longer open.",
            code: "no_file_chooser",
          });
        return json(res, 200, { answered: true });
      } catch (error) {
        if (error instanceof HumanControlError)
          return json(res, 409, { error: error.message, code: error.code });
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    return json(res, 404, { error: "Not found." });
  }
  return ctx.handled || res.writableEnded;
}
