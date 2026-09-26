import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdeState, AgentId, AgentModelsResult, Project, Session } from "./types";

const empty: AdeState = {
  hydrated: false,
  serviceAvailable: false,
  now: Date.now(),
  activeProjectId: "",
  projects: [],
  processes: [],
  sessions: [],
  agents: [],
};
type ProcessOp = "start" | "stop";
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
  }) => Promise<Session>;
  steer: (sessionId: string, text: string) => void;
  complete: (sessionId: string) => void;
  reopen: (sessionId: string) => void;
  stop: (sessionId: string) => void;
  switchAgent: (sessionId: string, agentId: AgentId) => Promise<void>;
  setSessionModel: (sessionId: string, model: string) => Promise<void>;
  process: (id: string, op: ProcessOp) => void;
  signIn: (agentId: AgentId) => Promise<{ output?: string; running?: boolean }>;
  agentModels: (agentId: AgentId) => Promise<AgentModelsResult>;
  setDefaultAgent: (projectId: string, agentId: AgentId) => void;
  runChecks: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
};
const Ctx = createContext<Api | null>(null);
async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (data) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(data);
  }
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Local API returned ${response.status}`);
  return value as T;
}
// Stable identity (outside the provider memo whose value changes on every
// 2-second polling refresh) so dependent effects do not refetch constantly.
export const agentModels = (agentId: AgentId) =>
  request<AgentModelsResult>(`/api/agents/${agentId}/models`);

export function AdeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdeState>(empty);
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
        activeProjectId: data.projects.some((p) => p.id === previous.activeProjectId)
          ? previous.activeProjectId
          : (data.projects[0]?.id ?? ""),
      }));
    } catch (error) {
      setState((previous) => ({ ...previous, hydrated: true, serviceAvailable: false }));
      console.error("ADE local service unavailable", error);
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
      steer: (sessionId, text) => {
        void request(`/api/sessions/${sessionId}/messages`, "POST", { text })
          .then(refresh)
          .catch((e) => window.alert(e.message));
      },
      complete: (id) => {
        void request(`/api/sessions/${id}/complete`, "POST")
          .then(refresh)
          .catch((e) => window.alert(e.message));
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
      process: (id, op) => {
        void request(`/api/processes/${id}/${op}`, "POST")
          .then(refresh)
          .catch((e) => window.alert(e.message));
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
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
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
