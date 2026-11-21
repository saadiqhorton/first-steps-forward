// Loopback ports for servers ADE starts itself: project dev servers and the
// Customize ADE preview.
import { connect, createServer } from "node:net";
import { DEFAULT_PORT } from "../shared/runtime-contract.mjs";

/** Whether something accepts a TCP connection on 127.0.0.1:`port`. */
export function probeConnection(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = connect({ port, host: "127.0.0.1" });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** An ephemeral loopback port the OS hands out. */
export function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const allocated = server.address().port;
      server.close(() => resolve(allocated));
    });
  });
}

/**
 * A free loopback port, never one in `avoid` (ADE's own default port by
 * default). Ask the OS for an ephemeral port, but do not return it until
 * nothing answers there: WSL's mirrored networking (verified) keeps a
 * just-closed loopback socket connectable for up to ~500 ms, and a false
 * connect would make a listen probe report "running" before the server binds.
 * @param {{ avoid?: number[], ask?: () => Promise<number> }} [options]
 */
export async function allocatePort({ avoid = [DEFAULT_PORT], ask = ephemeralPort } = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await ask();
    if (avoid.includes(port)) continue;
    const deadline = Date.now() + 1500;
    while (await probeConnection(port)) {
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(await probeConnection(port))) return port;
    // Still connectable after 1.5 s: something really owns it — fresh port.
  }
  throw new Error("Could not allocate a free loopback port.");
}
