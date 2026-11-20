import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { request, type RequestError } from "./api";
import type {
  AdeState,
  AgentComputer,
  AgentId,
  AgentModelsResult,
  HarnessJob,
  MessageAttachment,
  OptionCapabilities,
  Permission,
  Project,
  Session,
  SessionSummary,
  Workflow,
} from "./types";
import { recordingAttachment } from "@/lib/ade/browser/recordingUpload";
import { hasPendingUserRequest } from "@/lib/ade/sessionAttention.mjs";
import { warnUser } from "@/lib/ade/userNotices";

const empty: AdeState = {
  hydrated: false,
  serviceAvailable: false,
  now: Date.now(),
  activeProjectId: "",
  projects: [],
  processes: [],
  sessions: [],
  agents: [],
  authRequired: false,
};

type Api = {
  state: AdeState;
  selectProject: (id: string) => void;
  addProject: (name: string, path: string) => Promise<Project>;
  /** Clone a Git repository into `parent/<name>` and add it. `name` defaults to the repo name. */
  cloneProject: (url: string, parent: string, name?: string) => Promise<Project>;
  /** Make `parent/<name>` (optionally a Git repository) and add it. */
  createProject: (name: string, parent: string, git: boolean) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  startTask: (o: {
    projectId: string;
    agentId: AgentId;
    request: string;
    criteria: string;
    model?: string;
    effort?: string;
    speed?: string;
    permission?: Permission;
    attachmentIds?: string[];
    presentation?: import("./types").MessagePresentation;
  }) => Promise<Session>;
  steer: (
    sessionId: string,
    text: string,
    attachmentIds?: string[],
    when?: "now" | "later" | "drop" | "release",
    presentation?: import("./types").MessagePresentation,
  ) => Promise<void>;
  complete: (sessionId: string) => Promise<void>;
  reopen: (sessionId: string) => void;
  stop: (sessionId: string) => void;
  answerPermission: (sessionId: string, requestId: string, optionId: string) => Promise<void>;
  switchAgent: (
    sessionId: string,
    agentId: AgentId,
    selection: { model: string; effort: string; speed: string; permission: Permission },
  ) => Promise<void>;
  setSessionModel: (sessionId: string, model: string) => Promise<void>;
  setSessionOptions: (
    sessionId: string,
    o: { model?: string; effort?: string; speed?: string; permission?: Permission },
  ) => Promise<void>;
  harnessCommand: (agentId: AgentId, kind: "install" | "update") => string;
  startHarness: (agentId: AgentId, kind: "install" | "update") => Promise<HarnessJob>;

  signIn: (agentId: AgentId) => Promise<{ output?: string; running?: boolean }>;
  agentModels: (agentId: AgentId) => Promise<AgentModelsResult>;
  setDefaultAgent: (projectId: string, agentId: AgentId) => void;
  runChecks: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
};
const Ctx = createContext<Api | null>(null);
const ActiveProjectCtx = createContext<readonly [string, Dispatch<SetStateAction<string>>] | null>(
  null,
);
type BootstrapData = {
  projects: Project[];
  processes: AdeState["processes"];
  sessions: SessionSummary[];
  agents: AdeState["agents"];
  now: number;
};
export const bootstrapQuery = () =>
  queryOptions({
    queryKey: ["bootstrap"] as const,
    queryFn: () => request<BootstrapData>("/api/bootstrap"),
    staleTime: Infinity,
  });
export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id] as const,
    queryFn: async () =>
      (await request<{ session: Omit<Session, "logs"> }>(`/api/sessions/${id}`)).session,
    staleTime: Infinity,
    enabled: !!id,
  });
export function useSession(id: string) {
  return useQuery(sessionQuery(id));
}
export function useSessionLogs(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["session-logs", id] as const,
    queryFn: async () => {
      const previous = queryClient.getQueryData<{
        lines: { n: number; text: string }[];
        next: number;
        reset: boolean;
      }>(["session-logs", id]);
      const after = previous?.next ?? 0;
      const latest = await request<{
        lines: { n: number; text: string }[];
        next: number;
        reset: boolean;
      }>(`/api/sessions/${id}/logs?after=${after}`);
      return latest.reset || !previous
        ? latest
        : { ...latest, lines: [...previous.lines, ...latest.lines].slice(-500) };
    },
    staleTime: Infinity,
    enabled: !!id,
  });
}
export function useNow() {
  const serverNow = useAdeState((state) => state.now);
  const [now, setNow] = useState(() => serverNow);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const update = () => setNow(Date.now() + offset);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return now;
}
// Stable identity (outside the provider memo whose value changes on every
// 2-second polling refresh) so dependent effects do not refetch constantly.
export const agentModels = (agentId: AgentId) =>
  request<AgentModelsResult>(`/api/agents/${agentId}/models`);
const computerPath = (projectId: string, suffix: string, sessionId?: string | null) =>
  `/api/projects/${encodeURIComponent(projectId)}/computer${suffix}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`;
export const computerStatus = (projectId: string, sessionId?: string | null) =>
  request<AgentComputer>(computerPath(projectId, "", sessionId));
export const computerControl = (
  projectId: string,
  op: "start" | "stop" | "clear",
  sessionId?: string | null,
) => request<AgentComputer>(computerPath(projectId, `/${op}`, sessionId), "POST");
export const computerProfile = (
  projectId: string,
  profile: AgentComputer["profile"],
  sessionId?: string | null,
) => request<AgentComputer>(computerPath(projectId, "/profile", sessionId), "POST", { profile });
export const createComputerProfile = (projectId: string, name: string, sessionId?: string | null) =>
  request<AgentComputer>(computerPath(projectId, "/profiles", sessionId), "POST", { name });
export const renameComputerProfile = (
  projectId: string,
  profileId: string,
  name: string,
  sessionId?: string | null,
) =>
  request<AgentComputer>(
    computerPath(projectId, `/profiles/${encodeURIComponent(profileId)}`, sessionId),
    "PATCH",
    { name },
  );
export const deleteComputerProfile = (
  projectId: string,
  profileId: string,
  sessionId?: string | null,
) =>
  request<AgentComputer>(
    computerPath(projectId, `/profiles/${encodeURIComponent(profileId)}`, sessionId),
    "DELETE",
  );
export const browserImportSources = (projectId: string, sessionId?: string | null) =>
  request<{ sources: { id: string; name: string }[] }>(
    computerPath(projectId, "/import-sources", sessionId),
  );
export const importBrowserCookies = (
  projectId: string,
  sourceId: string,
  sessionId?: string | null,
  tabId?: string | null,
  profileId?: string | null,
) =>
  request<{ imported: number; skipped: number; keyringMissing?: boolean }>(
    computerPath(projectId, "/import", sessionId),
    "POST",
    { sourceId, ...(tabId ? { tabId } : {}), ...(profileId ? { profileId } : {}) },
  );
/** Answer ADE's "Run this dev command?" (session card or right pane). */
export const answerDevCommand = (projectId: string, requestId: string, allow: boolean) =>
  request(`/api/projects/${projectId}/dev/command/answer`, "POST", {
    requestId,
    decision: allow ? "allow" : "deny",
  });
/** Forget the project's approved dev command; the next start asks the user again. */
export const forgetDevCommand = (projectId: string) =>
  request(`/api/projects/${projectId}/dev/command/forget`, "POST");
export const harnessJob = (agentId: AgentId) =>
  request<HarnessJob>(`/api/agents/${agentId}/harness`);
export const optionCapabilities = (agentId: AgentId, model?: string) => {
  const query = model ? `?model=${encodeURIComponent(model)}` : "";
  return request<OptionCapabilities>(`/api/agents/${agentId}/capabilities${query}`);
};
export const saveWorkflow = async (
  w: Omit<Workflow, "id" | "builtIn"> & { id?: string },
): Promise<Workflow> => {
  const data = w.id
    ? await request<{ workflow: Workflow }>(`/api/workflows/${w.id}`, "POST", w)
    : await request<{ workflow: Workflow }>("/api/workflows", "POST", w);
  return data.workflow;
};
export const deleteWorkflow = async (id: string) => {
  await request(`/api/workflows/${id}/delete`, "POST");
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function uploadAttachment(file: File): Promise<MessageAttachment> {
  const contentBase64 = await fileToBase64(file);
  return request<MessageAttachment>("/api/attachments", "POST", {
    name: file.name,
    mime: file.type || "application/octet-stream",
    contentBase64,
  });
}

/** Browser recordings use a streaming upload so long clips do not become base64 request bodies. */
export async function uploadBrowserRecording(file: File): Promise<MessageAttachment> {
  const saved = recordingAttachment(file);
  if (saved) return saved;
  const response = await fetch("/api/attachments/recording", {
    method: "POST",
    headers: { "content-type": "video/webm" },
    body: file,
  });
  const value = (await response.json()) as MessageAttachment & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Local API returned ${response.status}`);
  return value;
}
export const searchSessions = (projectId: string, query: string) =>
  request<{ ids: string[] }>(
    `/api/sessions?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`,
  );

// Every way of adding a project ends the same: refresh, then focus it.
async function adoptProject(
  data: { project: Project },
  refresh: () => Promise<void>,
  setActiveProjectId: Dispatch<SetStateAction<string>>,
) {
  await refresh();
  setActiveProjectId(data.project.id);
  return data.project;
}

export function AdeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const bootstrap = useQuery(bootstrapQuery());
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const activeProjectId = bootstrap.data?.projects.some((p) => p.id === selectedProjectId)
    ? selectedProjectId
    : (bootstrap.data?.projects[0]?.id ?? selectedProjectId);
  const authRequired = (bootstrap.error as RequestError | null)?.authRequired === true;
  const state = useMemo<AdeState>(
    () => ({
      ...empty,
      ...bootstrap.data,
      hydrated: bootstrap.isFetched,
      serviceAvailable: bootstrap.isSuccess && !authRequired,
      authRequired,
      activeProjectId,
      projects: bootstrap.data?.projects ?? [],
      processes: bootstrap.data?.processes ?? [],
      sessions: bootstrap.data?.sessions ?? [],
      agents: bootstrap.data?.agents ?? [],
    }),
    [bootstrap.data, bootstrap.isFetched, bootstrap.isSuccess, authRequired, activeProjectId],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeProjectValue = useMemo(
    () => [selectedProjectId, setSelectedProjectId] as const,
    [selectedProjectId],
  );
  // One in-flight complete() per session; a second click joins the first
  // promise instead of firing a duplicate POST (which the server answers 409).
  const completeCalls = useRef(new Map<string, Promise<void>>());
  const refresh = useCallback(async () => {
    try {
      await queryClient.fetchQuery({ ...bootstrapQuery(), staleTime: 0 });
    } catch (error) {
      if (
        (error as RequestError).authRequired !== true &&
        (!(error instanceof Error) ||
          (error.name !== "CancelledError" && error.message !== "CancelledError"))
      )
        console.error("ADE local service unavailable", error);
    }
  }, [queryClient]);
  useEffect(() => {
    let ready = false;
    let errors = 0;
    let fallback: number | undefined;
    const invalidateAll = () => void queryClient.invalidateQueries();
    const pauseFallback = () => {
      if (!fallback || document.hidden) return;
      window.clearInterval(fallback);
      fallback = undefined;
    };
    const resumeFallback = () => {
      if (fallback || document.hidden) return;
      fallback = window.setInterval(() => void queryClient.invalidateQueries(), 15_000);
      void queryClient.invalidateQueries();
    };
    const visibility = () => {
      if (document.hidden) pauseFallback();
      else if (errors >= 3 || typeof EventSource === "undefined") resumeFallback();
    };
    document.addEventListener("visibilitychange", visibility);
    if (typeof EventSource === "undefined") {
      errors = 3;
      resumeFallback();
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        if (fallback) window.clearInterval(fallback);
      };
    }
    const query = activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : "";
    const source = new EventSource(`/api/events${query}`);
    const readyTimeout = window.setTimeout(() => {
      if (!ready) resumeFallback();
    }, 10_000);
    source.addEventListener("ready", () => {
      ready = true;
      errors = 0;
      if (readyTimeout) window.clearTimeout(readyTimeout);
      pauseFallback();
    });
    const onEvent = (event: MessageEvent<string>) => {
      let detail: { scope?: string } = {};
      try {
        detail = JSON.parse(event.data);
      } catch {
        // Ignore malformed invalidations; reconnect/fallback will refresh state.
      }
      const scope = detail.scope ?? "";
      if (scope === "bootstrap") void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      else if (scope.startsWith("session:")) {
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        void queryClient.invalidateQueries({ queryKey: ["session", scope.slice(8)] });
      } else if (scope.startsWith("logs:"))
        void queryClient.invalidateQueries({ queryKey: ["session-logs", scope.slice(5)] });
      else if (scope.startsWith("computer:")) {
        const id = scope.slice(9);
        void queryClient.invalidateQueries({ queryKey: ["computer", id] });
        void queryClient.invalidateQueries({ queryKey: ["browser", id] });
      } else if (scope === "agents")
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      else if (scope.startsWith("harness:"))
        void queryClient.invalidateQueries({ queryKey: ["harness", scope.slice(8)] });
      else if (scope === "customize")
        void queryClient.invalidateQueries({ queryKey: ["customize"] });
    };
    for (const type of [
      "bootstrap",
      "session",
      "logs",
      "computer",
      "agents",
      "harness",
      "customize",
    ])
      source.addEventListener(type, onEvent as EventListener);
    source.onerror = () => {
      errors += 1;
      if (ready) invalidateAll();
      ready = false;
      if (errors >= 3) resumeFallback();
    };
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (fallback) window.clearInterval(fallback);
      if (readyTimeout) window.clearTimeout(readyTimeout);
      source.close();
    };
  }, [activeProjectId, queryClient]);
  const api = useMemo<Api>(
    () => ({
      get state() {
        return stateRef.current;
      },
      refresh,
      selectProject: (id) => setSelectedProjectId(id),
      addProject: async (name, path) =>
        adoptProject(
          await request<{ project: Project }>("/api/projects", "POST", { name, path }),
          refresh,
          setSelectedProjectId,
        ),
      cloneProject: async (url, parent, name) =>
        adoptProject(
          await request<{ project: Project }>("/api/projects/clone", "POST", {
            url,
            parent,
            name,
          }),
          refresh,
          setSelectedProjectId,
        ),
      createProject: async (name, parent, git) =>
        adoptProject(
          await request<{ project: Project }>("/api/projects/create", "POST", {
            name,
            parent,
            git,
          }),
          refresh,
          setSelectedProjectId,
        ),
      removeProject: async (id) => {
        await request(`/api/projects/${id}/remove`, "POST");
        await refresh();
      },
      startTask: async (data) => {
        const session = await request<Session>("/api/sessions", "POST", data);
        await refresh();
        return session;
      },
      // Resolves only after the POST and the refresh; rejects on 4xx/5xx or
      // network failure so the caller can keep the draft and show the error.
      steer: async (sessionId, text, attachmentIds, when, presentation) => {
        await request(`/api/sessions/${sessionId}/messages`, "POST", {
          ...(text ? { text } : {}),
          ...(when ? { when } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
          ...(presentation ? { presentation } : {}),
        });
        await refresh();
      },
      complete: (id) => {
        const inFlight = completeCalls.current.get(id);
        if (inFlight) return inFlight;
        const call = request(`/api/sessions/${id}/complete`, "POST")
          .then(refresh)
          .catch((e) => void warnUser(e.message))
          .finally(() => completeCalls.current.delete(id));
        completeCalls.current.set(id, call);
        return call;
      },
      reopen: (id) => {
        void request(`/api/sessions/${id}/reopen`, "POST")
          .then(refresh)
          .catch((e) => void warnUser(e.message));
      },
      stop: (id) => {
        void request(`/api/sessions/${id}/stop`, "POST")
          .then(refresh)
          .catch((e) => void warnUser(e.message));
      },
      answerPermission: async (sessionId, requestId, optionId) => {
        await request(`/api/sessions/${sessionId}/permission`, "POST", { requestId, optionId });
        await refresh();
      },
      switchAgent: async (sessionId, agentId, selection) => {
        await request(`/api/sessions/${sessionId}/switch-agent`, "POST", {
          agentId,
          ...selection,
        });
        await refresh();
      },
      setSessionModel: async (sessionId, model) => {
        await request(`/api/sessions/${sessionId}/model`, "POST", { model });
        await refresh();
      },
      setSessionOptions: async (sessionId, o) => {
        await request(`/api/sessions/${sessionId}/options`, "POST", o);
        await refresh();
      },
      harnessCommand: (agentId, kind) => {
        const agent = stateRef.current.agents.find((a) => a.id === agentId);
        return agent?.harness?.[kind] ?? "";
      },
      startHarness: async (agentId, kind) => {
        const job = await request<HarnessJob>(`/api/agents/${agentId}/${kind}`, "POST");
        await refresh();
        return job;
      },

      signIn: (id) => request(`/api/agents/${id}/login`, "POST"),
      agentModels,
      setDefaultAgent: (projectId, agentId) => {
        void request(`/api/projects/${projectId}/default-agent`, "POST", { agentId })
          .then(refresh)
          .catch((e) => void warnUser(e.message));
      },
      runChecks: async (id) => {
        await request(`/api/sessions/${id}/checks`, "POST");
        await refresh();
      },
    }),
    [refresh],
  );
  return (
    <ActiveProjectCtx.Provider value={activeProjectValue}>
      <Ctx.Provider value={api}>{children}</Ctx.Provider>
    </ActiveProjectCtx.Provider>
  );
}
export function useAde() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAde must be used inside AdeProvider");
  return value;
}
/** Read or update the project selected by the shell and project switcher. */
export function useActiveProjectSelection() {
  const value = useContext(ActiveProjectCtx);
  if (!value) throw new Error("useActiveProjectSelection must be used inside AdeProvider");
  return value;
}
/** Subscribe to one bootstrap slice; React Query structural sharing avoids unrelated renders. */
export function useAdeState<T>(selector: (state: AdeState) => T): T {
  const projectSelection = useContext(ActiveProjectCtx);
  if (!projectSelection) throw new Error("useAdeState must be used inside AdeProvider");
  const [selectedProjectId] = projectSelection;
  const query = useQuery({
    ...bootstrapQuery(),
    select: (data) =>
      selector({
        ...empty,
        ...data,
        hydrated: true,
        serviceAvailable: true,
        authRequired: false,
        activeProjectId: data.projects.some((p) => p.id === selectedProjectId)
          ? selectedProjectId
          : (data.projects[0]?.id ?? selectedProjectId),
      }),
  });
  if (query.data !== undefined) return query.data;
  return selector({
    ...empty,
    hydrated: query.isFetched,
    serviceAvailable: query.error ? (query.error as RequestError).authRequired !== true : false,
    authRequired: (query.error as RequestError | null)?.authRequired === true,
    activeProjectId: selectedProjectId,
  });
}
export function useActiveProject() {
  return useAdeState(
    (state) =>
      state.projects.find((p) => p.id === state.activeProjectId) ??
      state.projects[0] ??
      ({
        id: "",
        name: "No project selected",
        path: "",
        branch: "",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "",
        addedAt: 0,
      } satisfies Project),
  );
}
export const ACTIVE: Session["status"][] = ["working", "verifying", "ready", "blocked"];
export function isActive(s: Pick<SessionSummary, "status">) {
  return ACTIVE.includes(s.status);
}
/** The running turn is paused on an agent question only the user can answer. */
export function needsYou(
  s: Pick<SessionSummary, "status" | "pendingPermissions" | "pendingDevCommand">,
) {
  return hasPendingUserRequest(s);
}
export function timeAgo(now: number, t?: number) {
  if (!now || !t) return "";
  const d = Math.max(0, now - t);
  const mins = Math.floor(d / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
