// Browser downloads follow T3 Code's server preview lifecycle: each tab owns its saved files.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT = 20;
const MAX_BYTES = 1024 * 1024 * 1024;
const noop = () => {};

/** Temporary downloads are scoped to a browser session and removed with their originating tab. */
export function createBrowserDownloads(notify) {
  const downloads = new Map();
  const closedPages = new WeakSet();
  const pending = new Set();
  let directory;
  let closed = false;
  const root = () => (directory ??= fs.mkdtemp(path.join(os.tmpdir(), "ade-browser-download-")));
  const publicEntry = ({ id, tabId, fileName, sizeBytes, completedAt }) => ({
    id,
    tabId,
    fileName,
    sizeBytes,
    completedAt,
  });
  const list = () => [...downloads.values()].map(publicEntry);
  const update = () => {
    try {
      notify(list());
    } catch {
      /* A disconnected viewer must not discard a saved file. */
    }
  };
  return {
    list,
    /** Files are saved or being saved; closing removes them. */
    get holdsFiles() {
      return downloads.size > 0 || pending.size > 0;
    },
    get(id) {
      return downloads.get(id) ?? null;
    },
    save(page, tabId, download) {
      const task = (async () => {
        const id = randomUUID();
        let target;
        try {
          if (closed || closedPages.has(page) || (await download.failure())) return;
          target = path.join(await root(), id);
          await download.saveAs(target);
          await fs.chmod(target, 0o600);
          const { size } = await fs.stat(target);
          if (closed || closedPages.has(page) || size > MAX_BYTES) {
            await fs.rm(target, { force: true });
            return;
          }
          const fileName =
            String(download.suggestedFilename() || "download")
              .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
              .slice(0, 255) || "download";
          downloads.set(id, {
            id,
            page,
            tabId,
            fileName,
            sizeBytes: size,
            completedAt: Date.now(),
            path: target,
          });
          const sameTab = [...downloads.values()].filter((entry) => entry.page === page);
          for (const entry of sameTab.slice(0, Math.max(0, sameTab.length - LIMIT))) {
            downloads.delete(entry.id);
            await fs.rm(entry.path, { force: true }).catch(noop);
          }
          update();
          return publicEntry(downloads.get(id));
        } catch {
          if (target) await fs.rm(target, { force: true }).catch(noop);
        } finally {
          await download.delete().catch(noop);
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task)).catch(noop);
      return task;
    },
    async closePage(page) {
      closedPages.add(page);
      const removed = [...downloads.values()].filter((entry) => entry.page === page);
      for (const entry of removed) downloads.delete(entry.id);
      if (removed.length) update();
      await Promise.all(removed.map((entry) => fs.rm(entry.path, { force: true }).catch(noop)));
    },
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      downloads.clear();
      if (directory) await fs.rm(await directory, { recursive: true, force: true }).catch(noop);
    },
  };
}
