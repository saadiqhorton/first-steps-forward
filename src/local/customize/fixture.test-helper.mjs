// Fixtures for the customize tests: a small stand-in "ADE" git checkout, and a
// scripted agent that edits the private copy then reports its turn finished.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const made = [];
process.once("exit", () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
export const tempDir = (prefix) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

export const git = (cwd, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const OK = `node -e ""`;

/**
 * A stand-in for ADE's launcher: serves /api/bootstrap on --port, starts a
 * grandchild (to prove the whole process group stops) and records both pids
 * and its HOME in $HOME/preview.json.
 */
export const PREVIEW_SERVER = `import http from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(
  path.join(process.env.HOME, "preview.json"),
  JSON.stringify({ pid: process.pid, grandchild: sleeper.pid, home: process.env.HOME, cwd: process.cwd(), adeHost: process.env.ADE_HOST ?? null }),
);
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ path: req.url, home: process.env.HOME }));
  })
  .listen(port, "127.0.0.1", () => console.log("preview listening on " + port));
`;
/** A launcher that fails the way a broken change would. */
export const CRASHING_SERVER = `console.error("TypeError: broken by this change");\nprocess.exit(1);\n`;
const BUILD = `node -e "const fs=require('fs');fs.mkdirSync('.output/public',{recursive:true});fs.writeFileSync('.output/public/_shell.html','built '+Date.now())"`;
/** A git checkout shaped like ADE: version, scripts the checks call, a locked file. */
export function makeStockRepo({ scripts = {}, version = "1.2.3" } = {}) {
  const dir = tempDir("ade-stock-");
  git(dir, "init", "-q");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "stock",
      version,
      scripts: {
        typecheck: OK,
        lint: OK,
        build: BUILD,
        test: `node -e "console.log('# pass 7'); console.log('HOME=' + process.env.HOME)"`,
        "token-audit": OK,
        ...scripts,
      },
    }),
  );
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n.output\n");
  mkdirSync(path.join(dir, "bin"));
  writeFileSync(path.join(dir, "bin", "ade.mjs"), PREVIEW_SERVER);
  writeFileSync(path.join(dir, "src", "tokens.css"), ":root { --a: 1; }\n");
  writeFileSync(path.join(dir, "src", "feature.txt"), "one\ntwo\nthree\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "stock");
  writeFileSync(path.join(dir, "untracked.txt"), "not in HEAD");
  return dir;
}
