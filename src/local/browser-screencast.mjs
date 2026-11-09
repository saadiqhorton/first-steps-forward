// One viewer's CDP screencast. It follows the session's active page, paces acks like T3, and
// drops to half scale while the viewer scrolls, then settles with a full-scale still.

const noop = () => {};
// Chromium allows three unacked frames, so 100 ms pacing caps viewers near 30 fps.
const SCREENCAST_ACK_PACE_MS = 100;
const SCREENCAST_SETTLE_MS = 200;
const SCREENCAST_MOTION_FRAMES = 4;
const SCREENCAST_MOTION_WINDOW_MS = 300;
const SCREENCAST_MOTION_QUALITY = 50;

/**
 * One viewer's CDP screencast. It follows the session's active page, paces acks like T3, and
 * drops to half scale while the viewer scrolls, then settles with a full-scale still.
 */
export class Screencast {
  #host;
  #params;
  #onFrame;
  #page = null;
  #session = null;
  #closed = false;
  #queue = Promise.resolve();
  #scale = 1;
  #motion = false;
  #recent = [];
  #framesInFlight = 0;
  #mayHaveDropped = false;
  #settle = null;
  #started = false;

  /**
   * @param {{ context: () => import("playwright-core").BrowserContext, lastWheelAt: () => number }} host
   * @param {{ maxWidth: number, maxHeight: number, quality: number, ackPaceMs?: number }} params
   * @param {(jpeg: Buffer, ack: () => void) => void} onFrame
   */
  constructor(host, params, onFrame) {
    this.#host = host;
    this.#params = params;
    this.#onFrame = onFrame;
  }

  async start(page) {
    await this.#attach(page);
    await this.#restart(1);
    // An idle page sends no frame to a new screencast, so the viewer starts from a still.
    if (!this.#started) await this.#still();
  }

  /** Moves the stream to a new active page. Frames from the old page are acked and dropped. */
  async retarget(page) {
    if (this.#closed || page === this.#page) return;
    const previous = this.#session;
    try {
      await this.#attach(page);
    } catch {
      return;
    }
    clearTimeout(this.#settle);
    this.#settle = null;
    this.#motion = false;
    this.#recent.length = 0;
    void previous
      ?.send("Page.stopScreencast")
      .catch(noop)
      .then(() => previous.detach())
      .catch(noop);
    await this.#restart(1);
    await this.#still();
  }

  async stop() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#settle);
    this.#settle = null;
    const session = this.#session;
    this.#session = null;
    await this.#queue;
    await session?.send("Page.stopScreencast").catch(noop);
    await session?.detach().catch(noop);
  }

  async #attach(page) {
    const context = typeof page.context === "function" ? page.context() : this.#host.context();
    const session = await context.newCDPSession(page);
    this.#page = page;
    this.#session = session;
    session.on("Page.screencastFrame", (frame) => this.#frame(session, frame));
  }

  // Start and stop calls are serialized so a motion change never races a settle.
  #restart(scale) {
    this.#scale = scale;
    this.#queue = this.#queue.then(async () => {
      const session = this.#session;
      if (this.#closed || !session) return;
      const { maxWidth, maxHeight, quality } = this.#params;
      await session.send("Page.stopScreencast").catch(noop);
      await session
        .send("Page.startScreencast", {
          format: "jpeg",
          quality: this.#scale < 1 ? Math.min(quality, SCREENCAST_MOTION_QUALITY) : quality,
          maxWidth: Math.max(1, Math.round(maxWidth * this.#scale)),
          maxHeight: Math.max(1, Math.round(maxHeight * this.#scale)),
        })
        .catch(noop);
    });
    return this.#queue;
  }

  async #still() {
    const session = this.#session;
    if (this.#closed || !session) return;
    const shot = await session
      .send("Page.captureScreenshot", { format: "jpeg", quality: this.#params.quality })
      .catch(() => null);
    if (!shot || this.#closed || session !== this.#session) return;
    this.#onFrame(Buffer.from(shot.data, "base64"), noop);
  }

  #frame(session, frame) {
    if (this.#closed) return;
    // A frame from a page that is no longer active is released to Chromium, not forwarded.
    if (session !== this.#session) {
      void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(noop);
      return;
    }
    this.#started = true;
    if (this.#framesInFlight > 0) this.#mayHaveDropped = true;
    this.#framesInFlight += 1;
    const arrivedAt = Date.now();
    this.#recent.push(arrivedAt);
    while (this.#recent[0] < arrivedAt - SCREENCAST_MOTION_WINDOW_MS) this.#recent.shift();
    const lastWheel = this.#host.lastWheelAt();
    if (
      !this.#params.ackPaceMs &&
      !this.#motion &&
      this.#recent.length >= SCREENCAST_MOTION_FRAMES &&
      arrivedAt - lastWheel < SCREENCAST_MOTION_WINDOW_MS
    ) {
      this.#motion = true;
      void this.#restart(0.5);
    } else if (this.#motion && arrivedAt - lastWheel > SCREENCAST_SETTLE_MS) {
      this.#motion = false;
      this.#recent.length = 0;
      void this.#restart(1);
    }
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => {
      this.#settle = null;
      if (!this.#motion && !this.#mayHaveDropped) return;
      this.#mayHaveDropped = false;
      if (this.#motion) {
        this.#motion = false;
        this.#recent.length = 0;
        void this.#restart(1);
      }
      void this.#still();
    }, SCREENCAST_SETTLE_MS);
    let acked = false;
    // Called once the viewer acks. Chromium gets its ack no sooner than the pacing allows.
    const ack = () => {
      if (acked) return;
      acked = true;
      setTimeout(
        () => {
          this.#framesInFlight -= 1;
          void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(noop);
        },
        arrivedAt + (this.#params.ackPaceMs ?? SCREENCAST_ACK_PACE_MS) - Date.now(),
      );
    };
    this.#onFrame(Buffer.from(frame.data, "base64"), ack);
  }
}
