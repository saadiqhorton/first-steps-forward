// One workspace write at a time. A save asked for while a write runs joins the
// single next one, so a burst of changes costs two writes instead of one each
// (overlapping writes used to wait on the workspace lock until it timed out).

/**
 * @param {() => Promise<unknown>} write
 * @param {{ delayMs?: number, onError?: (error: unknown) => void }} [options]
 */
export function createSaveQueue(write, { delayMs = 400, onError = () => {} } = {}) {
  /** @type {Promise<void> | null} */
  let running = null;
  /** @type {Promise<void> | null} */
  let next = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  /** Resolves once a write that started after this call has finished; rejects if it failed. */
  function save() {
    // Whatever a delayed save was waiting to write is part of this one.
    if (timer) clearTimeout(timer);
    timer = null;
    if (!running) {
      running = Promise.resolve()
        .then(write)
        .then(() => {})
        .finally(() => {
          running = null;
        });
      return running;
    }
    next ??= running
      .catch(() => {})
      .then(() => {
        next = null;
        return save();
      });
    return next;
  }

  /** Save within `delayMs`, for changes nobody waits on. A failure is reported, never thrown. */
  function saveSoon() {
    timer ??= setTimeout(() => {
      timer = null;
      save().catch(onError);
    }, delayMs);
  }

  /** Write now if a delayed save is waiting, and wait for writes under way. */
  async function flush() {
    if (timer) await save();
    else await (next ?? running);
  }

  return { save, saveSoon, flush };
}
