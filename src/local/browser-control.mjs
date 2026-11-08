// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/SessionControl.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// One control lock per project, shared by the browser stream, the noVNC desktop
// view, the computer_* tools and the browser_* tools. The human reserves control
// immediately; in-flight agent work drains before the human's input runs, and
// the agent's queued work is epoch-checked so it cannot act across an ownership
// change.

export const HUMAN_CONTROL_CODE = "human_control";
export const BROWSER_CLOSED_CODE = "browser_closed";

export class HumanControlError extends Error {
  constructor(message = "The user has taken control of the agent computer.") {
    super(message);
    this.name = "HumanControlError";
    this.code = HUMAN_CONTROL_CODE;
  }
}

export class BrowserClosedError extends Error {
  constructor(message = "The agent browser is closed.") {
    super(message);
    this.name = "BrowserClosedError";
    this.code = BROWSER_CLOSED_CODE;
  }
}

const AGENT_BLOCKED =
  "The user has taken control of the agent computer. Wait for them to hand control back, then try again.";
const CHANGED = "Browser control changed. Refresh the snapshot before trying again.";

/** Serializes agent and human work for one project and tracks who owns control. */
class Control {
  #listeners = new Set();
  #tail = Promise.resolve();
  #pending = Promise.resolve();
  #owner = null;
  #epoch = 0;
  #closed = false;

  /** @returns {{ owner: string|null, generation: number }} */
  state() {
    return { owner: this.#owner, generation: this.#epoch };
  }

  #changeOwner(owner) {
    this.#owner = owner;
    this.#epoch++;
    const state = this.state();
    for (const cb of [...this.#listeners]) cb(state);
  }

  #assertOpen() {
    if (this.#closed) throw new BrowserClosedError();
  }

  #enqueue(run) {
    const result = this.#tail.then(run);
    this.#tail = result.then(
      () => this.#pending,
      () => this.#pending,
    );
    return result;
  }

  /**
   * Records work that answers before it fully settles (for example a navigation
   * that commits later). Control changes wait for it to settle.
   * @param {Promise<unknown>} work
   */
  track(work) {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.#pending = Promise.all([this.#pending, settled]).then(() => undefined);
  }

  #action(allowed, run, message) {
    this.#assertOpen();
    const epoch = this.#epoch;
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (epoch !== this.#epoch || !allowed()) throw new HumanControlError(message);
      return run();
    });
  }

  /**
   * Runs agent work. Rejects while a human owns control, and when ownership
   * changes between the call and the moment the work would run.
   * @template A
   * @param {() => Promise<A>} run
   * @returns {Promise<A>}
   */
  async agent(run) {
    if (this.#owner !== null) throw new HumanControlError(AGENT_BLOCKED);
    return this.#action(() => this.#owner === null, run, CHANGED);
  }

  /**
   * Runs human work only while `viewerId` owns control. Anything else is ignored
   * silently and resolves to undefined.
   * @template A
   * @param {string} viewerId
   * @param {() => Promise<A>} run
   * @returns {Promise<A|undefined>}
   */
  async human(viewerId, run) {
    if (this.#owner !== viewerId) return undefined;
    this.#assertOpen();
    const epoch = this.#epoch;
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (epoch !== this.#epoch || this.#owner !== viewerId) return undefined;
      return run();
    });
  }

  /** Interrupts a pending navigation without waiting behind it in the input queue. */
  async humanInterrupt(viewerId, run) {
    this.#assertOpen();
    if (this.#owner !== viewerId) return undefined;
    const work = Promise.resolve().then(() => {
      if (this.#closed || this.#owner !== viewerId) return undefined;
      return run();
    });
    this.track(work);
    return work;
  }

  /**
   * Reads that need no control and do not queue, so the agent can look at a page
   * while the human drives it.
   * @template A
   * @param {() => Promise<A>} run
   * @returns {Promise<A>}
   */
  async observe(run) {
    this.#assertOpen();
    return run();
  }

  /** Serializes browser settings with agent and viewer input without taking ownership. */
  async system(run) {
    this.#assertOpen();
    return this.#enqueue(async () => {
      this.#assertOpen();
      return run();
    });
  }

  /**
   * Reserves control for `viewerId`. Taking while another viewer owns control
   * throws. Taking again as the owner is a no-op. Human work queued from here on
   * waits for in-flight agent work to drain.
   * @param {string} viewerId
   * @returns {{ owner: string|null, generation: number }}
   */
  take(viewerId) {
    this.#assertOpen();
    if (this.#owner !== null && this.#owner !== viewerId) {
      throw new HumanControlError("Another viewer controls this browser.");
    }
    if (this.#owner !== viewerId) this.#changeOwner(viewerId);
    return this.state();
  }

  /**
   * Hands control back. No-op unless `viewerId` owns it. `afterDrain` runs once
   * work queued before the release has drained (used to release held keys).
   * @param {string} viewerId
   * @param {() => Promise<void>} [afterDrain]
   * @returns {{ owner: string|null, generation: number }}
   */
  release(viewerId, afterDrain) {
    if (this.#owner !== viewerId) return this.state();
    this.#changeOwner(null);
    if (afterDrain) this.#enqueue(afterDrain).catch(() => {});
    return this.state();
  }

  /**
   * Subscribes to ownership changes.
   * @param {(state: { owner: string|null, generation: number }) => void} cb
   * @returns {() => void} unsubscribe
   */
  subscribe(cb) {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /** Closes the control: releases any owner and rejects further work. */
  async close() {
    if (!this.#closed) {
      this.#closed = true;
      this.#changeOwner(null);
    }
    await this.#tail;
  }
}

/**
 * One Control per project id, created on first use.
 * @returns {{ for(projectId: string): Control, delete(projectId: string): Promise<void> }}
 */
export function createControlRegistry() {
  const controls = new Map();
  return {
    for(projectId) {
      let control = controls.get(projectId);
      if (!control) {
        control = new Control();
        controls.set(projectId, control);
      }
      return control;
    },
    async delete(projectId) {
      const control = controls.get(projectId);
      if (!control) return;
      controls.delete(projectId);
      await control.close();
    },
  };
}
