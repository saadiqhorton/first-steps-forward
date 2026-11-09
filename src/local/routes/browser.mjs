import { COMPUTER_ERROR_STATUS } from "../computer.mjs";
import { INCOGNITO_PROFILE_ID } from "../browser-contexts.mjs";
import { HumanControlError } from "../browser-control.mjs";
import { resolveAttachments } from "../attachments.mjs";
import { body, PayloadTooLarge } from "../http.mjs";
import { browserScope } from "../browser-scope.mjs";
import { localServerDiscovery } from "../browser-local-servers.mjs";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { listFirefoxImportSources, readFirefoxImport } from "../browser-import-firefox.mjs";
import { listChromiumImportSources, readChromiumImport } from "../browser-import-chromium.mjs";
import { listSafariImportSources, readSafariImport } from "../browser-import-safari.mjs";
import {
  browserProfiles,
  selectedBrowserProfile,
  browserProfileStorageKey,
} from "../browser-profiles.mjs";
import { VIEWPORT_LIMITS, viewportAcceptable } from "../../shared/browser-contract.mjs";

const OBSERVE_BROWSER_ACTIONS = new Set(["status", "snapshot", "screenshot", "wait_for"]);
const OBSERVE_COMPUTER_ACTIONS = new Set(["screenshot", "wait"]);
const validTabId = (value) =>
  value === undefined || (typeof value === "string" && /^tab-\d+$/.test(value));
/** Files the preview may serve from a project, so local HTML pages render completely. */
const PREVIEW_FILE_TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  pdf: "application/pdf",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};
const ANNOTATION_STYLE_PROPERTIES = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "opacity",
  "border-radius",
  "border-color",
  "border-style",
  "border-width",
  "width",
  "height",
  "padding",
  "margin",
  "gap",
]);

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
    browserDevtools,
    save,
    computerView,
    json,
  } = ctx;
  const scopedRoute = parts[0] === "projects" && ["computer", "browser"].includes(parts[2]);
  const sessionId = scopedRoute
    ? new URL(req.url ?? "/", "http://localhost").searchParams.get("session")
    : null;
  if (
    sessionId &&
    !state.sessions.some((session) => session.id === sessionId && session.projectId === parts[1])
  )
    return json(res, 404, { error: "Conversation not found in this project." });
  const scope = browserScope(parts[1] ?? "", sessionId);
  if (parts[0] === "projects" && parts[2] === "computer") {
    const project = state.projects.find((x) => x.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    if (req.method === "GET" && parts.length === 3)
      return json(res, 200, computerView(project, scope));
    if (req.method === "POST" && parts[3] === "start") {
      // Returns at once; the UI polls status through installing/starting.
      computers.start(scope).catch(() => {});
      return json(res, 202, computerView(project, scope));
    }
    if (req.method === "POST" && parts[3] === "stop") {
      await computers.stop(scope);
      // The control lock belonged to the browser that just closed.
      await controls.delete(scope);
      return json(res, 200, computerView(project, scope));
    }
    if (req.method === "GET" && parts[3] === "import-sources" && parts.length === 4) {
      const sources = (
        await Promise.all([
          listFirefoxImportSources(),
          listChromiumImportSources(),
          listSafariImportSources(),
        ])
      ).flat();
      return json(res, 200, { sources: sources.map(({ id, name }) => ({ id, name })) });
    }
    if (req.method === "POST" && parts[3] === "import" && parts.length === 4) {
      const input = await body(req);
      if (typeof input.sourceId !== "string" || !/^[0-9a-f]{64}$/.test(input.sourceId))
        return json(res, 400, { error: "Select a browser profile to import." });
      if (!validTabId(input.tabId)) return json(res, 400, { error: "Invalid browser tab." });
      try {
        const [chromium, safari] = await Promise.all([
          listChromiumImportSources(),
          listSafariImportSources(),
        ]);
        const source = chromium.some((item) => item.id === input.sourceId)
          ? await readChromiumImport(input.sourceId)
          : safari.some((item) => item.id === input.sourceId)
            ? await readSafariImport(input.sourceId)
            : await readFirefoxImport(input.sourceId);
        await computers.start(scope);
        const target = await browserHub.get(scope);
        if (
          input.profileId !== undefined &&
          (typeof input.profileId !== "string" ||
            target.profileForTab(input.tabId) !== input.profileId)
        )
          return json(res, 409, {
            error: "The target tab's browser profile changed. Try the import again.",
          });
        const result = await target.importCookies(source.cookies, input.tabId);
        return json(res, 200, {
          imported: result.imported,
          skipped: source.skipped + result.skipped,
          ...(source.keyringMissing ? { keyringMissing: true } : {}),
        });
      } catch (error) {
        return json(res, 400, {
          error: [
            "Browser import requires Node 22.13 or newer.",
            "This browser uses app-bound encryption that cannot be imported.",
            "The browser's encryption key is unavailable.",
            "The operating system key store did not provide a key.",
            "The operating system key store is unavailable.",
            "Access to the operating system key store was denied.",
            "Install secret-tool (provided by libsecret) and unlock your system keyring to import these cookies.",
            "Install Python 3 and libsecret, or install secret-tool, and unlock your system keyring to import these cookies.",
            "Allow Full Disk Access for the app running ADE in macOS System Settings, then try again.",
          ].includes(error?.message)
            ? error.message
            : "Could not import browser cookies. Check that the source profile is available and try again.",
        });
      }
    }
    const projectScopes = () => [
      project.id,
      ...state.sessions
        .filter((item) => item.projectId === project.id)
        .map((item) => browserScope(project.id, item.id)),
    ];
    const stopScopes = async (scopes) => {
      const running = scopes.filter((key) =>
        ["running", "starting"].includes(computers.status(key).status),
      );
      await Promise.all(
        scopes.map(async (key) => {
          await computers.stop(key);
          await controls.delete(key);
        }),
      );
      return () => {
        for (const key of running) computers.start(key).catch(() => {});
      };
    };
    if (parts[3] === "profiles" && parts.length === 4 && req.method === "POST") {
      const input = await body(req);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 48)
        return json(res, 400, { error: "Profile names must be 1–48 characters." });
      const profiles = browserProfiles(project).slice(2);
      if (profiles.length >= 24)
        return json(res, 400, { error: "At most 24 named profiles are allowed." });
      project.browserProfiles = [...profiles, { id: randomUUID(), name }];
      await save();
      return json(res, 201, computerView(project, scope));
    }
    if (parts[3] === "profiles" && parts.length === 5 && ["PATCH", "DELETE"].includes(req.method)) {
      const profileId = parts[4];
      const profiles = browserProfiles(project).slice(2);
      if (!profiles.some((item) => item.id === profileId))
        return json(res, 404, { error: "Browser profile not found." });
      if (req.method === "PATCH") {
        const input = await body(req);
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 48)
          return json(res, 400, { error: "Profile names must be 1–48 characters." });
        project.browserProfiles = profiles.map((item) =>
          item.id === profileId ? { ...item, name } : item,
        );
        await save();
        return json(res, 200, computerView(project, scope));
      }
      const affected = projectScopes().filter(
        (key) =>
          selectedBrowserProfile(state, project, key) === profileId ||
          browserHub.peek(key)?.hasProfile(profileId),
      );
      const restart = await stopScopes(affected);
      try {
        await browserContexts.clearProfile(browserProfileStorageKey(project.id, profileId));
        project.browserProfiles = profiles.filter((item) => item.id !== profileId);
        if (project.browserProfile === profileId) delete project.browserProfile;
        if (project.browserSessionProfiles)
          for (const [conversationId, selected] of Object.entries(project.browserSessionProfiles))
            if (selected === profileId) project.browserSessionProfiles[conversationId] = "default";
        for (const item of state.sessions)
          if (item.projectId === project.id && item.browserProfile === profileId)
            item.browserProfile = "default";
        await save();
      } finally {
        restart();
      }
      return json(res, 200, computerView(project, scope));
    }
    if (req.method === "POST" && (parts[3] === "profile" || parts[3] === "clear")) {
      const input = parts[3] === "profile" ? await body(req) : {};
      const current = selectedBrowserProfile(state, project, scope);
      const profile = parts[3] === "profile" ? input.profile : current;
      if (!browserProfiles(project).some((item) => item.id === profile))
        return json(res, 400, { error: "Browser profile not found." });
      if (parts[3] === "clear" && profile === INCOGNITO_PROFILE_ID)
        return json(res, 400, { error: "Incognito data is cleared when its browser closes." });
      const changing = parts[3] === "clear" || current !== profile;
      if (changing) {
        if (parts[3] === "profile") {
          if (sessionId) {
            project.browserSessionProfiles ??= {};
            project.browserSessionProfiles[sessionId] = profile;
          } else if (profile === "default") delete project.browserProfile;
          else project.browserProfile = profile;
          await save();
          return json(res, 200, computerView(project, scope));
        }
        const scopes = projectScopes().filter(
          (key) =>
            selectedBrowserProfile(state, project, key) === profile ||
            browserHub.peek(key)?.hasProfile(profile),
        );
        const restart = await stopScopes(scopes);
        try {
          await browserContexts.clearProfile(browserProfileStorageKey(project.id, profile));
        } finally {
          restart();
        }
      }
      return json(res, 200, computerView(project, scope));
    }
    if (req.method === "POST" && parts[3] === "action") {
      // Agent tools (MCP server / Pi extension): starts the browser on first use, then runs
      // one screenshot/mouse/keyboard action on its page.
      try {
        const input = await body(req);
        const control = controls.for(scope);
        const run = () => computers.action(scope, input);
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
      const control = controls.for(scope);
      try {
        if (input.action === "take") return json(res, 200, control.take(viewer));
        if (input.action === "release")
          return json(
            res,
            200,
            control.release(viewer, async () => {
              // BrowserSession owns the pressed-key and button records shared by every transport.
              await browserHub.peek(scope)?.releaseInput();
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
    if (req.method === "GET" && parts[3] === "local-servers" && parts.length === 4) {
      // Web servers already listening on this machine, as T3's preview empty state lists.
      // ADE's own port is the request's; a project's managed dev server is listed separately.
      const servers = await localServerDiscovery.scan([req.socket.localPort]);
      return json(res, 200, { servers });
    }
    if (req.method === "GET" && parts[3] === "files" && parts.length >= 5) {
      // A workspace file served so the browser can show a local HTML page or PDF, plus the
      // page's own styles, scripts and images. Anything else in the project stays private.
      let requested;
      try {
        requested = parts
          .slice(4)
          .map((segment) => decodeURIComponent(segment))
          .join("/");
      } catch {
        return json(res, 400, { error: "Invalid file path." });
      }
      if (requested.split("/").some((segment) => segment.startsWith(".")))
        return json(res, 403, { error: "That file is outside the previewable project files." });
      try {
        const root = await realpath(project.path);
        const target = await realpath(path.resolve(root, requested));
        const relative = path.relative(root, target);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          return json(res, 403, { error: "That file is outside this project." });
        const contentType = PREVIEW_FILE_TYPES[path.extname(target).slice(1).toLowerCase()] ?? null;
        if (!contentType)
          return json(res, 400, { error: "That file type does not open in the browser." });
        const info = await stat(target);
        if (!info.isFile()) return json(res, 404, { error: "File not found in this project." });
        const stream = createReadStream(target);
        stream.once("error", () => {
          if (!res.headersSent) json(res, 404, { error: "File not found in this project." });
          else res.destroy();
        });
        stream.once("open", () => {
          res.setHeader("content-type", contentType);
          res.setHeader("content-length", info.size);
          res.setHeader("cache-control", "no-store");
          res.setHeader("x-content-type-options", "nosniff");
          stream.pipe(res);
        });
        res.once("close", () => stream.destroy());
        return true;
      } catch {
        return json(res, 404, { error: "File not found in this project." });
      }
    }
    if (req.method === "GET" && parts[3] === "devtools") {
      const tabId =
        new URL(req.url ?? "/", "http://localhost").searchParams.get("tab") ?? undefined;
      if (!validTabId(tabId)) return json(res, 400, { error: "Invalid browser tab." });
      if (!browserHub.peek(scope)) return json(res, 409, { error: "The browser is not running." });
      return json(res, 200, { socketPath: browserDevtools.path(project.id, sessionId, tabId) });
    }
    if (req.method === "GET" && parts.length === 3) {
      const computer = computers.status(scope);
      const { owner, generation } = controls.for(scope).state();
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
        streamUrl: browserStream.url(project.id, sessionId),
        control,
      });
    }
    if (req.method === "POST" && parts[3] === "action") {
      // Agent tools (browser_* in computer-tools-defs.mjs): one Playwright action.
      const input = await body(req);
      const name = String(input.action ?? "").replace(/^browser_/, "");
      const control = controls.for(scope);
      const run = () => browserHub.get(scope).then((s) => s.runAgentAction(input));
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
    if (req.method === "POST" && parts[3] === "inspect-element") {
      const input = await body(req);
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0)
        return json(res, 400, { error: "Valid viewport coordinates are required." });
      if (!validTabId(input.tabId)) return json(res, 400, { error: "Invalid browser tab." });
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const element = await controls
          .for(scope)
          .observe(() =>
            session.inspectElement(input.x, input.y, input.tabId, input.includeContext !== false),
          );
        return json(res, 200, { element });
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
      }
    }
    if (req.method === "GET" && parts[3] === "downloads") {
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      if (parts.length === 4) return json(res, 200, { downloads: session.downloads() });
      if (parts.length !== 5 || !/^[0-9a-f-]{36}$/i.test(parts[4]))
        return json(res, 404, { error: "Download not found." });
      const file = session.openDownload(parts[4]);
      if (!file) return json(res, 404, { error: "Download not found." });
      const name = file.fileName.toWellFormed();
      const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
      const stream = createReadStream(file.path);
      stream.once("error", () => {
        if (!res.headersSent) json(res, 404, { error: "Download not found." });
        else res.destroy();
      });
      stream.once("open", () => {
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-length", file.sizeBytes);
        res.setHeader(
          "content-disposition",
          `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-content-type-options", "nosniff");
        stream.pipe(res);
      });
      res.once("close", () => stream.destroy());
      return true;
    }
    if (req.method === "POST" && parts[3] === "inspect-region") {
      const input = await body(req);
      const rect = input.rect;
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width < 3 ||
        rect.height < 3 ||
        !validTabId(input.tabId)
      )
        return json(res, 400, { error: "A valid browser region is required." });
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const elements = await controls
          .for(scope)
          .observe(() => session.inspectRegion(rect, input.tabId));
        return json(res, 200, { elements });
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
      }
    }
    if (req.method === "POST" && parts[3] === "annotation-rects") {
      const input = await body(req);
      if (
        !validTabId(input.tabId) ||
        !Array.isArray(input.selectors) ||
        input.selectors.length > 50 ||
        !input.selectors.every(
          (selector) =>
            typeof selector === "string" && selector.length > 0 && selector.length <= 2000,
        )
      )
        return json(res, 400, { error: "Valid browser selectors are required." });
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const rects = await controls
          .for(scope)
          .observe(() => session.annotationRects(input.selectors, input.tabId));
        return json(res, 200, { rects });
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
      }
    }
    if (req.method === "POST" && parts[3] === "capture") {
      const input = await body(req);
      if (!validTabId(input.tabId)) return json(res, 400, { error: "Invalid browser tab." });
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const image = await controls
          .for(scope)
          .observe(() => session.captureScreenshot(input.tabId));
        res.statusCode = 200;
        res.setHeader("content-type", "image/png");
        res.setHeader("cache-control", "no-store");
        return res.end(image);
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
      }
    }
    if (req.method === "POST" && parts[3] === "annotation-style") {
      const input = await body(req);
      if (typeof input.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.sessionId))
        return json(res, 400, { error: "A valid annotation session is required." });
      if (!validTabId(input.tabId)) return json(res, 400, { error: "Invalid browser tab." });
      if (
        input.selector !== undefined &&
        (typeof input.selector !== "string" || !input.selector || input.selector.length > 2000)
      )
        return json(res, 400, { error: "A valid element selector is required." });
      if (
        input.action === "apply" &&
        (!input.selector ||
          !ANNOTATION_STYLE_PROPERTIES.has(input.property) ||
          typeof input.value !== "string" ||
          !input.value.trim() ||
          input.value.length > 500)
      )
        return json(res, 400, { error: "A supported style and value are required." });
      if (input.action !== "apply" && input.action !== "restore")
        return json(res, 400, { error: "Unknown annotation style action." });
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const result = await controls
          .for(scope)
          .system(() =>
            input.action === "apply"
              ? session.setAnnotationStyle(
                  input.sessionId,
                  input.selector,
                  input.property,
                  input.value,
                  input.tabId,
                )
              : session.restoreAnnotationStyles(input.sessionId, input.selector),
          );
        return json(res, 200, { result: result ?? null });
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
      }
    }
    if (parts[3] === "settings" && (req.method === "GET" || req.method === "POST")) {
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      if (req.method === "GET") {
        const tabId = new URL(req.url, "http://127.0.0.1").searchParams.get("tab") ?? undefined;
        if (!validTabId(tabId)) return json(res, 400, { error: "Invalid browser tab." });
        try {
          return json(res, 200, session.browserSettings(tabId));
        } catch (error) {
          return json(res, 409, { error: error?.message ?? String(error) });
        }
      }
      const input = await body(req);
      if (!validTabId(input.tabId)) return json(res, 400, { error: "Invalid browser tab." });
      if (
        input.zoomFactor !== undefined &&
        (typeof input.zoomFactor !== "number" ||
          !Number.isFinite(input.zoomFactor) ||
          input.zoomFactor < 0.25 ||
          input.zoomFactor > 5)
      )
        return json(res, 400, { error: "Invalid browser zoom." });
      if (
        input.colorScheme !== undefined &&
        !["system", "light", "dark"].includes(input.colorScheme)
      )
        return json(res, 400, { error: "Invalid color scheme." });
      if (input.clear !== undefined && !["cookies", "cache"].includes(input.clear))
        return json(res, 400, { error: "Invalid browser data selection." });
      if (input.viewport !== undefined && !viewportAcceptable(input.viewport ?? {}))
        return json(res, 400, {
          error: `Viewport dimensions must be ${VIEWPORT_LIMITS.minWidth}–${VIEWPORT_LIMITS.maxWidth}×${VIEWPORT_LIMITS.minHeight}–${VIEWPORT_LIMITS.maxHeight} pixels, with an area no larger than ${VIEWPORT_LIMITS.maxWidth}×${VIEWPORT_LIMITS.maxHeight}.`,
        });
      try {
        const settings = await controls.for(scope).system(() => session.adjustBrowser(input));
        return json(res, 200, settings);
      } catch (error) {
        return json(res, 500, { error: error?.message ?? String(error) });
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
      const session = browserHub.peek(scope);
      if (!session) return json(res, 409, { error: "The agent browser is not running." });
      try {
        const ids = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];
        const files = (await resolveAttachments(DATA_DIR, ids)).map((file) => ({
          name: file.name,
          mimeType: file.mime,
          buffer: file.bytes,
        }));
        const answered = await controls
          .for(scope)
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
