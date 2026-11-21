#!/usr/bin/env node
// The `ade` command: `ade [--port N] [--host H | --remote] [--open] [--stock]` serves the UI and
// API from one process (with kept Customize ADE changes, a thin supervisor runs the kept version
// as a child: src/local/supervisor.mjs), `ade doctor` reports what this machine is missing, and `ade browser-setup` prepares a
// Linux host for the agent browser. The small runtime contract is loaded before checking Node;
// the application modules stay dynamic so unsupported Node versions get a useful error first.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_PORT, MIN_NODE_MAJOR } from "../src/shared/runtime-contract.mjs";

const USAGE = `Usage: ade [--port N] [--host H | --remote] [--open] [--stock]
       ade doctor
       ade browser-setup

  --port N   listen on port N (default ${DEFAULT_PORT}, like npm run dev; PORT also works)
  --host H   listen on H (default 127.0.0.1; non-loopback needs ADE_TOKEN)
  --remote   use ADE from your phone or other computers on the same Wi-Fi:
             prints a link to open on them (plus one for Tailscale, if connected)
  --open     open ADE in the default browser once it is listening
  --stock    run ADE without the changes you kept in Customize ADE`;

if (Number(process.versions.node.split(".")[0]) < MIN_NODE_MAJOR) {
  console.error(
    `ADE needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${process.versions.node}. Install a newer Node from https://nodejs.org/ and try again.`,
  );
  process.exit(1);
}

/** Opens `url` in the default browser; the URL is an argument, never parsed by a shell. */
function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["explorer.exe", [url]]
        : ["xdg-open", [url]];
  // Explorer delegates HTTP URLs to the default browser without a shell wrapper.
  const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => console.log(`Could not open a browser; open ${url} yourself.`));
  child.unref();
}

/** The command that starts this ADE again, for "Restart ADE to use your changes". */
function commandLine({ port, host, remote }) {
  const base = process.env.npm_command === "exec" ? "npx @dezignerdrugz/ade" : "ade";
  const parts = [base];
  if (port !== DEFAULT_PORT) parts.push(`--port ${port}`);
  if (remote) parts.push("--remote");
  else if (host) parts.push(`--host ${host}`);
  return parts.join(" ");
}

/** Run the kept version under the supervisor; resolves with the exit code. */
async function supervise({ port, host, remote, open, dataDir, stockBin, announced = false }) {
  const { superviseAde } = await import("../src/local/supervisor.mjs");
  if (!port) {
    const { ephemeralPort } = await import("../src/local/ports.mjs");
    port = await ephemeralPort();
  }
  const { done } = superviseAde({
    dataDir,
    stockBin,
    port,
    host,
    remote,
    announced,
    onReady: (url) => {
      if (announced) console.log("ADE restarted with your changes.");
      else if (open) openBrowser(url);
    },
  });
  return done;
}

/**
 * "Restart ADE" in stock one-process ADE: free the port, stop this server's
 * services, and run the kept version under a supervisor in this same process
 * (the same stop() a dev-server reload uses), so Ctrl+C and the terminal keep working.
 */
async function handOff({ port, host, remote, live, dataDir, stockBin }) {
  const bound = live.server?.address()?.port ?? port;
  for (const [signal, handler] of live.handlers) process.off(signal, handler);
  live.stopRemote?.();
  const { stop } = await import("../src/local/ade-local.mjs");
  if (live.server) {
    const closed = new Promise((resolve) => live.server.close(() => resolve(undefined)));
    live.server.closeAllConnections();
    await closed;
  }
  await stop();
  void supervise({ port: bound, host, remote, dataDir, stockBin, announced: true }).then((code) =>
    process.exit(code),
  );
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        remote: { type: "boolean" },
        open: { type: "boolean" },
        stock: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [command, ...extra] = positionals;
  if (extra.length > 0 || (command && command !== "doctor" && command !== "browser-setup")) {
    console.error(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
    return 1;
  }

  if (command === "doctor") {
    const { formatCheck, runDoctor } = await import("../src/local/doctor.mjs");
    const checks = await runDoctor();
    for (const item of checks) console.log(formatCheck(item));
    return checks.some((item) => item.level === "fail") ? 1 : 0;
  }

  if (command === "browser-setup") {
    const script = fileURLToPath(new URL("../scripts/browser-setup.mjs", import.meta.url));
    const child = spawn(process.execPath, [script], { stdio: "inherit", shell: false });
    return new Promise((resolve) => {
      child.on("error", () => resolve(1));
      child.on("close", (code) => resolve(code ?? 1));
    });
  }

  const raw = values.port ?? process.env.PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${raw}`);
    return 1;
  }
  if (values.remote && values.host) {
    console.error(`Use either --remote or --host, not both.\n\n${USAGE}`);
    return 1;
  }
  const staticDir = fileURLToPath(new URL("../.output/public", import.meta.url));
  const stockBin = fileURLToPath(import.meta.url);
  const dataDir = path.join(os.homedir(), ".ade");
  // A kept version this supervisor started: the normal one-process server, plus IPC.
  const supervised = process.env.ADE_SUPERVISED === "1" && typeof process.send === "function";
  const quiet = process.env.ADE_LAUNCH_QUIET === "1";
  const flags = { port, host: values.host, remote: values.remote };
  if (!supervised && !values.stock) {
    const { keptTarget } = await import("../src/local/supervisor.mjs");
    if (await keptTarget(dataDir))
      return supervise({ ...flags, open: values.open, dataDir, stockBin });
  }
  if (supervised)
    // The supervisor is gone (killed outright): take everything this server started with it.
    process.once("disconnect", () => {
      try {
        if (process.platform !== "win32") process.kill(-process.pid, "SIGTERM");
      } catch {}
      process.exit(0);
    });
  const { setLauncher } = await import("../src/local/launcher.mjs");
  /** @type {{ server?: import("node:http").Server, stopRemote?: () => void, handlers: [string, () => void][] }} */
  const live = { handlers: [] };
  if (!supervised)
    setLauncher({
      running: null,
      stockFlag: !!values.stock,
      command: commandLine(flags),
      // Stock ADE in one process hands its port to a supervisor running the kept version.
      restart: values.stock ? null : () => handOff({ ...flags, live, dataDir, stockBin }),
    });
  try {
    let url;
    const log = quiet ? () => {} : console.log;
    if (values.remote) {
      const { launchRemote } = await import("../src/local/remote.mjs");
      const remote = await launchRemote({ port, staticDir, dataDir, log });
      url = remote.url;
      live.server = remote.server;
      live.stopRemote = remote.stop;
      // A terminal's Ctrl+C reaches `tailscale serve` too, but a plain `kill` of ADE would not.
      for (const signal of ["SIGINT", "SIGTERM"]) {
        const handler = () => {
          remote.stop();
          process.exit(0);
        };
        live.handlers.push([signal, handler]);
        process.once(signal, handler);
      }
    } else {
      const { launchAde } = await import("../src/local/launch.mjs");
      const launched = await launchAde({ port, host: values.host, staticDir, log });
      url = launched.url;
      live.server = launched.server;
    }
    if (values.open && !quiet) openBrowser(url);
  } catch (error) {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is already in use. Pick another with --port.`
        : error.message,
    );
    return 1;
  }
  return null; // the server keeps the process alive
}

const code = await main();
if (code !== null) process.exit(code);
