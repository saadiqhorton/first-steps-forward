import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  ProjectDocument,
  Session,
  Workflow,
} from "./types";
import { TokenGate } from "@/components/ade/TokenGate";

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
  }) => Promise<Session>;
  steer: (
    sessionId: string,
    text: string,
    attachmentIds?: string[],
    when?: "now" | "later" | "drop" | "release",
  ) => Promise<void>;
  complete: (sessionId: string) => Promise<void>;
  reopen: (sessionId: string) => void;
  stop: (sessionId: string) => void;
  switchAgent: (sessionId: string, agentId: AgentId) => Promise<void>;
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
type RequestError = Error & { status?: number; authRequired?: boolean };
async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (data) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(data);
  }
  const response = await fetch(url, init);
  const value = (await response.json()) as { error?: string; authRequired?: boolean };
  if (!response.ok) {
    const error: RequestError = new Error(value.error ?? `Local API returned ${response.status}`);
    error.status = response.status;
    error.authRequired = value.authRequired === true;
    throw error;
  }
  return value as T;
}
// Stable identity (outside the provider memo whose value changes on every
// 2-second polling refresh) so dependent effects do not refetch constantly.
export const agentModels = (agentId: AgentId) =>
  request<AgentModelsResult>(`/api/agents/${agentId}/models`);
export const computerStatus = (projectId: string) =>
  request<AgentComputer>(`/api/projects/${projectId}/computer`);
export const computerControl = (projectId: string, op: "start" | "stop") =>
  request<AgentComputer>(`/api/projects/${projectId}/computer/${op}`, "POST");
export const harnessJob = (agentId: AgentId) =>
  request<HarnessJob>(`/api/agents/${agentId}/harness`);
export const optionCapabilities = (agentId: AgentId, model?: string) => {
  const query = model ? `?model=${encodeURIComponent(model)}` : "";
  return request<OptionCapabilities>(`/api/agents/${agentId}/capabilities${query}`);
};
export const listWorkflows = async () => {
  const data = await request<{ workflows: Workflow[] }>("/api/workflows");
  return data.workflows;
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
export const listDocuments = async (projectId: string) => {
  const data = await request<{ documents: ProjectDocument[] }>(
    `/api/editor/${projectId}/documents`,
  );
  return data.documents;
};

export function AdeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdeState>(empty);
  // One in-flight complete() per session; a second click joins the first
  // promise instead of firing a duplicate POST (which the server answers 409).
  const completeCalls = useRef(new Map<string, Promise<void>>());
  const refresh = async () => {
    try {
      const data = await request<
        Omit<AdeState, "hydrated" | "activeProjectId" | "serviceAvailable"> & {
          projects: Project[];
        }
      >("/api/bootstrap");
      setState((previous) => ({
        ...data,
        hydrated: true,
        serviceAvailable: true,
        authRequired: false,
        activeProjectId: data.projects.some((p) => p.id === previous.activeProjectId)
          ? previous.activeProjectId
          : (data.projects[0]?.id ?? ""),
      }));
    } catch (error) {
      // 401 + authRequired means ADE is exposed beyond loopback and this
      // browser has not proven the token yet: show the token gate instead
      // of the "service unavailable" state.
      const authRequired = (error as RequestError).authRequired === true;
      setState((previous) => ({
        ...previous,
        hydrated: true,
        serviceAvailable: !authRequired,
        authRequired,
      }));
      if (!authRequired) console.error("ADE local service unavailable", error);
    }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, []);
  const api = useMemo<Api>(
    () => ({
      state,
      refresh,
      selectProject: (id) => setState((s) => ({ ...s, activeProjectId: id })),
      addProject: async (name, path) => {
        const data = await request<{ project: Project }>("/api/projects", "POST", { name, path });
        await refresh();
        setState((s) => ({ ...s, activeProjectId: data.project.id }));
        return data.project;
      },
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
      steer: async (sessionId, text, attachmentIds, when) => {
        await request(`/api/sessions/${sessionId}/messages`, "POST", {
          ...(text ? { text } : {}),
          ...(when ? { when } : {}),
          ...(attachmentIds?.length ? { attachmentIds } : {}),
        });
        await refresh();
      },
      complete: (id) => {
        const inFlight = completeCalls.current.get(id);
        if (inFlight) return inFlight;
        const call = request(`/api/sessions/${id}/complete`, "POST")
          .then(refresh)
          .catch((e) => window.alert(e.message))
          .finally(() => completeCalls.current.delete(id));
        completeCalls.current.set(id, call);
        return call;
      },
      reopen: (id) => {
        void request(`/api/sessions/${id}/reopen`, "POST")
          .then(refresh)
          .catch((e) => window.alert(e.message));
      },
      stop: (id) => {
        void request(`/api/sessions/${id}/stop`, "POST")
          .then(refresh)
          .catch((e) => window.alert(e.message));
      },
      switchAgent: async (sessionId, agentId) => {
        await request(`/api/sessions/${sessionId}/switch-agent`, "POST", { agentId });
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
        const agent = state.agents.find((a) => a.id === agentId);
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
          .catch((e) => window.alert(e.message));
      },
      runChecks: async (id) => {
        await request(`/api/sessions/${id}/checks`, "POST");
        await refresh();
      },
    }),
    [state],
  );
  return (
    <Ctx.Provider value={api}>
      {state.authRequired ? <TokenGate onUnlocked={() => refresh()} /> : children}
    </Ctx.Provider>
  );
}
export function useAde() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAde must be used inside AdeProvider");
  return value;
}
export function useActiveProject() {
  const { state } = useAde();
  return (
    state.projects.find((p) => p.id === state.activeProjectId) ??
    state.projects[0] ??
    ({
      id: "",
      name: "No project selected",
      path: "",
      branch: "",
      ahead: 0,
      uncommittedFiles: [],
      defaultAgent: "codex",
      addedAt: 0,
    } satisfies Project)
  );
}
export const ACTIVE: Session["status"][] = ["working", "verifying", "ready", "blocked"];
export function isActive(s: Session) {
  return ACTIVE.includes(s.status);
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
