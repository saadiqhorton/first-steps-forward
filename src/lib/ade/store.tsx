import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  AdeState,
  AgentId,
  Approval,
  FileChange,
  LocalProcess,
  Message,
  Project,
  Session,
  Step,
} from "./types";
import { initialState, SEED_BASE } from "./seed";
import { buildScript, steerScript } from "./scripts";

const STORAGE_KEY = "ade.workspace.v1";

type Action =
  | { type: "hydrate"; state: Partial<AdeState> }
  | { type: "tick"; now: number }
  | { type: "selectProject"; id: string }
  | { type: "addProject"; project: Project }
  | { type: "startTask"; session: Session }
  | { type: "answer"; sessionId: string; answer: string }
  | { type: "decide"; sessionId: string; approved: boolean }
  | { type: "steer"; sessionId: string; text: string }
  | { type: "complete"; sessionId: string }
  | { type: "reopen"; sessionId: string }
  | { type: "stop"; sessionId: string }
  | { type: "switchAgent"; sessionId: string; agentId: AgentId }
  | { type: "process"; id: string; op: "start" | "stop" }
  | { type: "signIn"; agentId: AgentId; account: string }
  | { type: "signOut"; agentId: AgentId }
  | { type: "setDefaultAgent"; projectId: string; agentId: AgentId };

let idc = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(idc++).toString(36)}`;

const msg = (role: Message["role"], text: string, at: number): Message => ({ id: uid("m"), role, text, at });

function applyStep(s: Session, step: Step, now: number): Session {
  const next: Session = { ...s, updatedAt: now, step: s.step + 1, nextAt: now + step.delay };
  const tag = `${s.agentId}`;
  switch (step.kind) {
    case "say":
      next.messages = [...s.messages, msg("agent", step.text, now)];
      next.status = "working";
      next.logs = [...s.logs, `${tag}: message`];
      break;
    case "ask":
      next.status = "needs_input";
      next.question = step.question;
      next.messages = [...s.messages, msg("agent", step.question.text, now)];
      next.logs = [...s.logs, `${tag}: waiting for user input`];
      break;
    case "approve":
      next.status = "awaiting_approval";
      next.approval = step.approval;
      next.messages = [
        ...s.messages,
        msg("system", `Paused: "${step.approval.action}" needs your confirmation before it runs.`, now),
      ];
      next.logs = [...s.logs, `${tag}: action requires approval (${step.approval.risk})`];
      break;
    case "edit": {
      const merged = new Map<string, FileChange>();
      for (const f of s.changes) merged.set(f.path, f);
      for (const f of step.files) merged.set(f.path, f);
      next.changes = Array.from(merged.values());
      next.status = "working";
      next.messages = [...s.messages, msg("agent", `Edited ${step.files.length} file${step.files.length === 1 ? "" : "s"}.`, now)];
      next.logs = [...s.logs, ...step.files.map((f) => `${tag}: edit ${f.path}`)];
      break;
    }
    case "verify":
      next.status = "verifying";
      if (step.checks.length) next.checks = step.checks;
      else next.checks = s.checks.map((c) => (c.status === "failed" ? { ...c, status: "passed", detail: "24 passed" } : c));
      next.logs = [...s.logs, `${tag}: running checks`];
      break;
    case "ready":
      next.status = s.checks.some((c) => c.status === "failed") ? "ready" : "ready";
      next.summary = step.summary;
      next.messages = [...s.messages, msg("agent", step.summary, now)];
      next.logs = [...s.logs, `${tag}: run finished`];
      break;
  }
  return next;
}

function reducer(state: AdeState, a: Action): AdeState {
  switch (a.type) {
    case "hydrate":
      return { ...state, ...a.state, hydrated: true };
    case "tick": {
      let changed = false;
      const sessions = state.sessions.map((s) => {
        if (!["working", "verifying"].includes(s.status)) return s;
        if (s.step >= s.script.length) return s;
        if (s.nextAt > a.now) return s;
        changed = true;
        return applyStep(s, s.script[s.step], a.now);
      });
      const processes = state.processes.map((p) => {
        if (p.status !== "running" || Math.random() > 0.08) return p;
        const line = p.port === 8787 ? `GET /invoices/${100 + Math.floor(Math.random() * 900)} 200 ${5 + Math.floor(Math.random() * 30)}ms` : `${new Date(a.now).toTimeString().slice(0, 8)} [vite] hmr update /src/components/SaleBanner.tsx`;
        changed = true;
        return { ...p, output: [...p.output.slice(-40), line] };
      });
      return changed ? { ...state, now: a.now, sessions, processes } : { ...state, now: a.now };
    }
    case "selectProject":
      return { ...state, activeProjectId: a.id };
    case "addProject":
      return {
        ...state,
        projects: [...state.projects, a.project],
        activeProjectId: a.project.id,
        processes: [
          ...state.processes,
          { id: uid("p"), projectId: a.project.id, name: "Dev server", command: "npm run dev", port: 5174, status: "stopped", output: [] },
        ],
      };
    case "startTask":
      return { ...state, sessions: [a.session, ...state.sessions] };
    case "answer":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id !== a.sessionId
            ? s
            : {
                ...s,
                status: "working",
                question: undefined,
                messages: [...s.messages, msg("user", a.answer, state.now)],
                nextAt: state.now + 900,
                updatedAt: state.now,
              },
        ),
      };
    case "decide":
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.id !== a.sessionId) return s;
          if (a.approved)
            return {
              ...s,
              status: "working",
              approval: undefined,
              messages: [...s.messages, msg("user", `Approved: ${s.approval?.action} (${s.approval?.scope})`, state.now)],
              logs: [...s.logs, `user: approved ${s.approval?.action}`],
              nextAt: state.now + 900,
              updatedAt: state.now,
            };
          return {
            ...s,
            status: "stopped",
            approval: undefined,
            messages: [
              ...s.messages,
              msg("user", "Not approved.", state.now),
              msg("system", "Stopped before the action ran. Nothing outside this project was changed.", state.now),
            ],
            logs: [...s.logs, `user: declined ${s.approval?.action}`],
            updatedAt: state.now,
          };
        }),
      };
    case "steer":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id !== a.sessionId
            ? s
            : {
                ...s,
                status: "working",
                question: undefined,
                messages: [...s.messages, msg("user", a.text, state.now)],
                script: [...s.script.slice(0, s.step), ...steerScript(a.text), ...s.script.slice(s.step)],
                nextAt: state.now + 800,
                updatedAt: state.now,
              },
        ),
      };
    case "complete":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id !== a.sessionId ? s : { ...s, status: "complete", completedAt: state.now, updatedAt: state.now },
        ),
      };
    case "reopen":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id !== a.sessionId
            ? s
            : { ...s, status: "ready", completedAt: undefined, updatedAt: state.now, messages: [...s.messages, msg("system", "Reopened. Previous changes and checks are kept.", state.now)] },
        ),
      };
    case "stop":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id !== a.sessionId
            ? s
            : { ...s, status: "stopped", question: undefined, approval: undefined, updatedAt: state.now, messages: [...s.messages, msg("system", "Stopped by you. Edits made so far are kept in the working tree.", state.now)] },
        ),
      };
    case "switchAgent":
      return {
        ...state,
        sessions: state.sessions.map((s) => {
          if (s.id !== a.sessionId) return s;
          const to = state.agents.find((x) => x.id === a.agentId)!;
          const note = to.carriesConversation
            ? `Switched to ${to.name}. Repository state, request, and prior conversation carried over.`
            : `Switched to ${to.name}. Repository state, request, and files changed carried over. ${to.name} cannot read the previous conversation, so it starts from the task and current diff.`;
          return { ...s, agentId: a.agentId, messages: [...s.messages, msg("system", note, state.now)], updatedAt: state.now };
        }),
      };
    case "process":
      return {
        ...state,
        processes: state.processes.map((p) => {
          if (p.id !== a.id) return p;
          if (a.op === "start")
            return {
              ...p,
              status: "running",
              startedAt: state.now,
              output: [`$ ${p.command}`, `Starting…`, p.port ? `Listening on http://localhost:${p.port}/` : "Watching for changes…"],
            } as LocalProcess;
          return { ...p, status: "stopped", output: [...p.output, "^C", "Process exited (0)"] } as LocalProcess;
        }),
      };
    case "signIn":
      return { ...state, agents: state.agents.map((g) => (g.id === a.agentId ? { ...g, signedIn: true, account: a.account } : g)) };
    case "signOut":
      return { ...state, agents: state.agents.map((g) => (g.id === a.agentId ? { ...g, signedIn: false, account: undefined } : g)) };
    case "setDefaultAgent":
      return { ...state, projects: state.projects.map((p) => (p.id === a.projectId ? { ...p, defaultAgent: a.agentId } : p)) };
  }
}

interface Api {
  state: AdeState;
  selectProject: (id: string) => void;
  addProject: (name: string, path: string) => Project;
  startTask: (o: { projectId: string; agentId: AgentId; request: string; criteria: string }) => Session;
  answer: (sessionId: string, answer: string) => void;
  decide: (sessionId: string, approved: boolean) => void;
  steer: (sessionId: string, text: string) => void;
  complete: (sessionId: string) => void;
  reopen: (sessionId: string) => void;
  stop: (sessionId: string) => void;
  switchAgent: (sessionId: string, agentId: AgentId) => void;
  process: (id: string, op: "start" | "stop") => void;
  signIn: (agentId: AgentId, account: string) => void;
  signOut: (agentId: AgentId) => void;
  setDefaultAgent: (projectId: string, agentId: AgentId) => void;
}

const Ctx = createContext<Api | null>(null);

function shift<T extends Record<string, unknown>>(o: T, delta: number, keys: string[]): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) if (typeof out[k] === "number" && (out[k] as number) > 0) out[k] = (out[k] as number) + delta;
  return out as T;
}

export function AdeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let loaded: Partial<AdeState> | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = null;
    }
    const now = Date.now();
    if (!loaded) {
      const delta = now - SEED_BASE;
      loaded = {
        projects: initialState.projects.map((p) => shift(p, delta, ["addedAt"])),
        processes: initialState.processes.map((p) => shift(p, delta, ["startedAt"])),
        sessions: initialState.sessions.map((s) => ({
          ...shift(s, delta, ["createdAt", "updatedAt", "completedAt"]),
          messages: s.messages.map((mm) => shift(mm, delta, ["at"])),
        })),
      };
    }
    dispatch({ type: "hydrate", state: { ...loaded, now } });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    const id = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => clearInterval(id);
  }, [state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    const { hydrated: _h, now: _n, ...persist } = state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
    } catch {
      /* ignore */
    }
  }, [state]);

  const api = useMemo<Api>(
    () => ({
      state,
      selectProject: (id) => dispatch({ type: "selectProject", id }),
      addProject: (name, path) => {
        const project: Project = {
          id: uid("proj"),
          name,
          path,
          branch: "main",
          ahead: 0,
          uncommittedFiles: [],
          defaultAgent: "codex",
          addedAt: Date.now(),
        };
        dispatch({ type: "addProject", project });
        return project;
      },
      startTask: ({ projectId, agentId, request, criteria }) => {
        const project = state.projects.find((p) => p.id === projectId)!;
        const now = Date.now();
        const session: Session = {
          id: uid("s"),
          projectId,
          agentId,
          createdBy: agentId,
          request,
          criteria,
          status: "working",
          messages: [msg("user", request + (criteria ? `\n\nAcceptance criteria: ${criteria}` : ""), now)],
          changes: [],
          checks: [],
          logs: [`${agentId}: context manifest built (project ${project.name}, branch ${project.branch})`],
          script: buildScript(project, request, criteria),
          step: 0,
          nextAt: now + 600,
          createdAt: now,
          updatedAt: now,
        };
        dispatch({ type: "startTask", session });
        return session;
      },
      answer: (sessionId, answer) => dispatch({ type: "answer", sessionId, answer }),
      decide: (sessionId, approved) => dispatch({ type: "decide", sessionId, approved }),
      steer: (sessionId, text) => dispatch({ type: "steer", sessionId, text }),
      complete: (sessionId) => dispatch({ type: "complete", sessionId }),
      reopen: (sessionId) => dispatch({ type: "reopen", sessionId }),
      stop: (sessionId) => dispatch({ type: "stop", sessionId }),
      switchAgent: (sessionId, agentId) => dispatch({ type: "switchAgent", sessionId, agentId }),
      process: (id, op) => dispatch({ type: "process", id, op }),
      signIn: (agentId, account) => dispatch({ type: "signIn", agentId, account }),
      signOut: (agentId) => dispatch({ type: "signOut", agentId }),
      setDefaultAgent: (projectId, agentId) => dispatch({ type: "setDefaultAgent", projectId, agentId }),
    }),
    [state],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAde() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAde must be used inside AdeProvider");
  return c;
}

export function useActiveProject() {
  const { state } = useAde();
  return state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
}

export const NEEDS_YOU: Session["status"][] = ["needs_input", "awaiting_approval"];
export const ACTIVE: Session["status"][] = ["working", "verifying", "needs_input", "awaiting_approval", "ready", "blocked"];

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

export type { Approval };
