#!/usr/bin/env node
// The `ade` command: `ade [--port N] [--host H] [--open]` serves the UI and API from one
// process, `ade doctor` reports what this machine is missing, and `ade browser-setup` prepares a
// Linux host for the agent browser. Everything is imported after the Node check so an old Node
// gets a message instead of a syntax error.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MIN_NODE_MAJOR = 22;
const USAGE = `Usage: ade [--port N] [--host H] [--open]
       ade doctor
       ade browser-setup

  --port N   listen on port N (default 3000; PORT also works)
  --host H   listen on H (default 127.0.0.1; non-loopback needs ADE_TOKEN)
  --open     open ADE in the default browser once it is listening`;

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

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        open: { type: "boolean" },
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

  const raw = values.port ?? process.env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${raw}`);
    return 1;
  }
  const { launchAde } = await import("../src/local/launch.mjs");
  try {
    const { url } = await launchAde({
      port,
      host: values.host,
      staticDir: fileURLToPath(new URL("../.output/public", import.meta.url)),
    });
    if (values.open) openBrowser(url);
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
