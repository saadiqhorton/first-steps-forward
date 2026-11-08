// Persists each conversation's preview tabs without embedding project paths in filenames.
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createBrowserSessionStore(root) {
  const pending = new Map();
  const fileFor = (key) =>
    path.join(root, `${createHash("sha256").update(key).digest("hex")}.json`);
  return {
    async read(key) {
      try {
        await pending.get(key)?.catch(() => {});
        const value = JSON.parse(await fs.readFile(fileFor(key), "utf8"));
        if (!value || !Array.isArray(value.tabs) || value.tabs.length > 200) return null;
        const ids = new Set();
        const tabs = value.tabs.filter((tab) => {
          if (
            !tab ||
            typeof tab.id !== "string" ||
            !/^tab-\d+$/.test(tab.id) ||
            !Number.isSafeInteger(Number(tab.id.slice(4))) ||
            Number(tab.id.slice(4)) < 1 ||
            Number(tab.id.slice(4)) > 1_000_000_000 ||
            ids.has(tab.id) ||
            typeof tab.url !== "string" ||
            !(tab.url === "about:blank" || /^https?:\/\//i.test(tab.url)) ||
            (tab.profileId !== undefined &&
              (typeof tab.profileId !== "string" ||
                !(
                  tab.profileId === "default" ||
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    tab.profileId,
                  )
                )))
          )
            return false;
          ids.add(tab.id);
          return true;
        });
        return tabs.length
          ? { activeId: typeof value.activeId === "string" ? value.activeId : null, tabs }
          : null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      const previous = pending.get(key) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          await fs.mkdir(root, { recursive: true, mode: 0o700 });
          const target = fileFor(key);
          const temporary = `${target}.${randomUUID()}.part`;
          try {
            await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
            await fs.rename(temporary, target);
          } finally {
            await fs.rm(temporary, { force: true }).catch(() => {});
          }
        });
      pending.set(key, next);
      void next
        .finally(() => {
          if (pending.get(key) === next) pending.delete(key);
        })
        .catch(() => {});
      return next;
    },
    async remove(key) {
      await pending.get(key)?.catch(() => {});
      await fs.rm(fileFor(key), { force: true });
    },
    async flush() {
      await Promise.allSettled([...pending.values()]);
    },
  };
}
