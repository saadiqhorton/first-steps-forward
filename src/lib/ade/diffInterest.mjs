/**
 * Serializes Diff-tab interest POSTs so an older in-flight watch cannot leave
 * interest true after a later unwatch (open→close race / Strict Mode remount).
 *
 * Each watch() call owns a cancelled flag. Cleanup either prevents the watch
 * POST, or pairs it with an unwatch once the watch has landed.
 *
 * @param {(projectId: string, diff: boolean) => Promise<void>} post
 */
export function createDiffInterestController(post) {
  let chain = Promise.resolve();

  return {
    /** @param {string} projectId */
    watch(projectId) {
      let cancelled = false;
      let active = false;

      chain = chain
        .catch(() => {})
        .then(async () => {
          if (cancelled) return;
          await post(projectId, true);
          active = true;
          if (cancelled) {
            active = false;
            await post(projectId, false);
          }
        });

      return () => {
        cancelled = true;
        if (!active) return;
        active = false;
        chain = chain.catch(() => {}).then(() => post(projectId, false));
      };
    },
    /** Drain the queue (tests). */
    idle() {
      return chain.catch(() => {});
    },
  };
}
