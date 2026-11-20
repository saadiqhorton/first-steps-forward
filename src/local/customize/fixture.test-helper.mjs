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
        build: OK,
        test: `node -e "console.log('# pass 7'); console.log('HOME=' + process.env.HOME)"`,
        "token-audit": OK,
        ...scripts,
      },
    }),
  );
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(path.join(dir, "src", "tokens.css"), ":root { --a: 1; }\n");
  writeFileSync(path.join(dir, "src", "feature.txt"), "one\ntwo\nthree\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "stock");
  writeFileSync(path.join(dir, "untracked.txt"), "not in HEAD");
  return dir;
}
