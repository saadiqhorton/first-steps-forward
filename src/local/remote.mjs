// `ade --remote`: use ADE from the user's phone or other computers with nothing to configure.
// ADE listens on the local network and prints a sign-in link for devices on the same Wi-Fi. When
// Tailscale is already connected it adds a link for the tailnet too (HTTPS through `tailscale
// serve` when the tailnet allows it). The access token gates every remote request and rides in
// each printed link.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchAde } from "./launch.mjs";
import { runCommand, spawnCommand } from "./spawn.mjs";

/**
 * The access token `ade --remote` signs devices in with. Made once and kept in `dataDir`, so links
 * and signed-in devices keep working across restarts; deleting the file signs every device out.
 * @param {string} dataDir
 * @returns {Promise<string>}
 */
export async function remoteToken(dataDir) {
  const file = path.join(dataDir, "remote-token");
  const saved = await fs.readFile(file, "utf8").catch(() => "");
  if (saved.trim()) return saved.trim();
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(16).toString("hex");
  try {
    await fs.writeFile(file, `${token}\n`, { mode: 0o600, flag: "wx" });
    return token;
  } catch (error) {
    // Another ADE made it first; use theirs so both print the same link.
    if (error?.code === "EEXIST") return (await fs.readFile(file, "utf8")).trim();
    throw error;
  }
}

/**
 * This machine on Tailscale, or null when Tailscale is not installed or not connected. `https` is
 * false until HTTPS certificates are turned on for the tailnet, which `tailscale serve` needs.
 * @param {typeof runCommand} [run]
 * @returns {Promise<{ name: string, https: boolean } | null>}
 */
export async function tailscaleStatus(run = runCommand) {
  const res = await run("tailscale", ["status", "--json"], { timeout: 5000 });
  if (res.code !== 0) return null;
  try {
    const status = JSON.parse(res.stdout);
    if (status.BackendState !== "Running" || !status.Self?.DNSName) return null;
    return {
      name: status.Self.DNSName.replace(/\.$/, ""),
      https: (status.CertDomains ?? []).length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Runs `tailscale serve` in the foreground for as long as ADE runs: Tailscale serves HTTPS on the
 * tailnet name, proxies it to ADE's loopback port, and drops the share when the command exits, so
 * nothing is left in the user's Tailscale settings. Resolves once Tailscale reports the share is
 * live; rejects with what it printed otherwise.
 * @param {number} port
 * @param {{ spawn?: typeof spawnCommand, timeoutMs?: number, onExit?: () => void }} [options]
 * @returns {Promise<{ stop: () => void }>}
 */
export function shareOnTailnet(port, { spawn = spawnCommand, timeoutMs = 15_000, onExit } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("tailscale", ["serve", "--https=443", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let live = false;
    const said = () =>
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" ");
    const fail = (reason) => {
      clearTimeout(timer);
      reject(new Error(reason));
    };
    const timer = setTimeout(() => {
      child.kill("SIGINT");
      fail(`it did not start within ${timeoutMs / 1000} s. ${said()}`.trim());
    }, timeoutMs);
    const read = (chunk) => {
      output += chunk;
      if (live || !/Available within your tailnet/i.test(output)) return;
      live = true;
      clearTimeout(timer);
      resolve({ stop: () => child.kill("SIGINT") });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (error) => fail(error.message));
    child.on("close", (code) => {
      if (live) onExit?.();
      else fail(said() || `tailscale serve exited (${code}).`);
    });
  });
}

/**
 * IPv4 addresses other devices can reach this machine on: Tailscale's (100.64.0.0/10) and the
 * local network's. Container and VM bridges are skipped; nothing outside this machine uses them.
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
 */
export function networkAddresses(interfaces = os.networkInterfaces()) {
  const tailnet = [];
  const lan = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth|virbr|vboxnet|vmnet|cni|podman)/.test(name)) continue;
    for (const { address, family, internal } of addresses ?? []) {
      if (internal || (family !== "IPv4" && family !== 4) || address.startsWith("169.254."))
        continue;
      const [a, b] = address.split(".").map(Number);
      (a === 100 && b >= 64 && b <= 127 ? tailnet : lan).push(address);
    }
  }
  return { tailnet, lan };
}

/**
 * Starts ADE shared with the user's other devices and prints the links to open there.
 * @param {{
 *   staticDir: string,
 *   port: number,
 *   dataDir: string,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (line: string) => void,
 *   run?: typeof runCommand,
 *   spawn?: typeof spawnCommand,
 *   interfaces?: ReturnType<typeof os.networkInterfaces>,
 *   launch?: typeof launchAde,
 * }} options
 * @returns {Promise<{ server: import("node:http").Server, url: string, links: string[], stop: () => void }>}
 *   `url` is this computer's own address; `stop` ends the Tailscale share.
 */
export async function launchRemote({
  staticDir,
  port,
  dataDir,
  env = process.env,
  log = console.log,
  run = runCommand,
  spawn = spawnCommand,
  interfaces = os.networkInterfaces(),
  launch = launchAde,
}) {
  // `tailscale serve` must know the port before ADE binds it.
  if (!port) throw new Error("ade --remote needs a fixed port; pick one with --port.");
  env.ADE_TOKEN = (env.ADE_TOKEN ?? "").trim() || (await remoteToken(dataDir));
  const signIn = (base) => `${base}/?token=${encodeURIComponent(env.ADE_TOKEN)}`;
  const tailscale = await tailscaleStatus(run);
  let share = null;
  if (tailscale?.https) {
    try {
      share = await shareOnTailnet(port, {
        spawn,
        onExit: () => log("Tailscale stopped sharing ADE; restart ADE to share it again."),
      });
    } catch {
      // Tailscale is an extra: its devices still get the plain tailnet address below.
    }
  }
  let server;
  try {
    // Every interface: the Wi-Fi link, the tailnet address, and `tailscale serve` on loopback.
    ({ server } = await launch({ staticDir, port, host: "0.0.0.0", env, log: () => {} }));
  } catch (error) {
    share?.stop();
    throw error;
  }
  const local = `http://127.0.0.1:${port}`;
  const { tailnet, lan } = networkAddresses(interfaces);
  const targets = [
    ...lan.map((address) => ({ base: `http://${address}:${port}`, via: "same Wi-Fi" })),
    ...(share
      ? [{ base: `https://${tailscale.name}`, via: "Tailscale" }]
      : tailnet.map((address) => ({ base: `http://${address}:${port}`, via: "Tailscale" }))),
  ];
  const links = targets.map(({ base }) => signIn(base));
  const lines = ["ADE is running.", `  This computer:  ${local}`];
  targets.forEach(({ via }, i) =>
    lines.push(`  ${i ? "               " : "Your devices:  "} ${links[i]}  (${via})`),
  );
  if (!links.length)
    lines.push("  No network address found; connect this computer to Wi-Fi and start again.");
  else
    lines.push("Open a link once on each phone or laptop; it stays signed in. Ctrl+C stops ADE.");
  if (lan.length) lines.push("Wi-Fi links are plain HTTP: fine at home, not on public Wi-Fi.");
  for (const line of lines) log(line);
  return { server, url: local, links, stop: () => share?.stop() };
}
