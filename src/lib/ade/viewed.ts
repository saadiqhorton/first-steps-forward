import { useEffect, useSyncExternalStore } from "react";
import type { Session } from "@/lib/ade/types";
import { filterSessions as filterSessionsJs, isUnread as isUnreadJs } from "./conversations.mjs";

export const VIEWED_KEY = "ade-session-viewed";

export type ConversationFilter = "all" | "needs" | "working" | "unread";

export function isUnread(session: Session, viewed: Record<string, number>): boolean {
  return isUnreadJs(session, viewed);
}

export function filterSessions(
  sessions: Session[],
  o: {
    filter: ConversationFilter;
    query: string;
    showCompleted: boolean;
    viewed: Record<string, number>;
  },
): Session[] {
  return filterSessionsJs(sessions, o) as Session[];
}

function readViewed(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIEWED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let cached: Record<string, number> = {};
let cachedRaw: string | null | undefined = undefined;
const listeners = new Set<() => void>();
let storageBound = false;

function onStorage(e: StorageEvent) {
  if (e.key === VIEWED_KEY || e.key === null) emit();
}

function ensureStorageListener() {
  if (storageBound || typeof window === "undefined") return;
  window.addEventListener("storage", onStorage);
  storageBound = true;
}

function releaseStorageListener() {
  if (!storageBound || typeof window === "undefined" || listeners.size > 0) return;
  window.removeEventListener("storage", onStorage);
  storageBound = false;
}

function snapshot(): Record<string, number> {
  if (typeof window === "undefined") return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(VIEWED_KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = readViewed();
  return cached;
}

function emit() {
  cachedRaw = undefined;
  cached = readViewed();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureStorageListener();
  return () => {
    listeners.delete(listener);
    releaseStorageListener();
  };
}

export function markViewed(sessionId: string, at: number): void {
  if (typeof window === "undefined") return;
  const next = { ...readViewed(), [sessionId]: at };
  try {
    window.localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode
  }
  emit();
}

/** Re-renders on markViewed and on cross-tab `storage` events. */
export function useViewed(): Record<string, number> {
  useEffect(() => {
    // Ensure first client paint picks up storage after SSR empty snapshot.
    emit();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, () => ({}));
}
