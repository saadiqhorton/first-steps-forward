import { useEffect, useRef, useState, type SetStateAction } from "react";
import { loadFeedbackDraft, saveFeedbackDraft } from "@/lib/ade/browser/feedbackPersistence";
import { warnUser } from "@/components/ade/NoticeDialog";

function useStorageWarning() {
  const warned = useRef(false);
  return (error: unknown) => {
    console.warn("Could not store browser feedback:", error);
    if (warned.current) return;
    warned.current = true;
    void warnUser(
      "Browser feedback remains available in this window, but could not be saved for reload.",
    );
  };
}

export const feedbackScope = (projectId: string, sessionId: string) =>
  JSON.stringify([projectId, sessionId]);

/** Load each scope before writing it, retaining background recording drafts in memory. */
export function usePersistentFeedbackList<T extends { id: string }, Stored>(
  kind: string,
  scope: string | null,
  scopeOf: (item: T) => string,
  encode: (item: T) => Stored,
  decode: (item: Stored) => T,
) {
  const [items, setItems] = useState<T[]>([]);
  const [generation, setGeneration] = useState(0);
  const loaded = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const lastSaved = useRef(new Map<string, T[]>());
  const warnStorage = useStorageWarning();
  useEffect(() => {
    if (!scope || loaded.current.has(scope) || failed.current.has(scope)) return;
    let active = true;
    void loadFeedbackDraft<Stored[]>(`${kind}:${scope}`)
      .then((saved) => {
        if (!active) return;
        const restored = (saved ?? []).map(decode);
        setItems((current) => {
          const ids = new Set(current.map((item) => item.id));
          return [...restored.filter((item) => !ids.has(item.id)), ...current];
        });
        loaded.current.add(scope);
        setGeneration((value) => value + 1);
      })
      .catch((error) => {
        if (active) {
          failed.current.add(scope);
          warnStorage(error);
        }
      });
    return () => {
      active = false;
    };
  }, [kind, scope, decode]);
  useEffect(() => {
    for (const storedScope of loaded.current) {
      const matching = items.filter((item) => scopeOf(item) === storedScope);
      const previous = lastSaved.current.get(storedScope);
      if (
        previous &&
        previous.length === matching.length &&
        previous.every((item, index) => item === matching[index])
      )
        continue;
      lastSaved.current.set(storedScope, matching);
      void saveFeedbackDraft(
        `${kind}:${storedScope}`,
        matching.length ? matching.map(encode) : undefined,
      ).catch((error) => {
        if (lastSaved.current.get(storedScope) === matching) lastSaved.current.delete(storedScope);
        warnStorage(error);
      });
    }
  }, [kind, items, generation, scopeOf, encode]);
  return [items, setItems] as const;
}

export function usePersistentFeedbackNotes(key: string | null) {
  const [state, setState] = useState<{
    key: string | null;
    notes: Record<string, string>;
    ready: boolean;
  }>({ key, notes: {}, ready: false });
  const warnStorage = useStorageWarning();
  const activeKey = useRef(key);
  activeKey.current = key;
  useEffect(() => {
    if (!key) return;
    let active = true;
    void loadFeedbackDraft<Record<string, string>>(key)
      .then((saved) => {
        if (active)
          setState((current) => ({
            key,
            notes: { ...(saved ?? {}), ...(current.key === key ? current.notes : {}) },
            ready: true,
          }));
      })
      .catch((error) => {
        if (active) warnStorage(error);
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    if (!key || state.key !== key || !state.ready) return;
    const entries = Object.entries(state.notes).filter(([, value]) => value);
    void saveFeedbackDraft(key, entries.length ? Object.fromEntries(entries) : undefined).catch(
      warnStorage,
    );
  }, [key, state]);
  const setNotes = (update: SetStateAction<Record<string, string>>) => {
    if (activeKey.current !== key) return;
    setState((current) => {
      const notes = current.key === key ? current.notes : {};
      return {
        key,
        notes: typeof update === "function" ? update(notes) : update,
        ready: current.key === key && current.ready,
      };
    });
  };
  return [state.key === key ? state.notes : {}, setNotes] as const;
}
