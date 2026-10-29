import test from "node:test";
import assert from "node:assert/strict";
import {
  folderNameError,
  parseRepoSource,
  redactCredentials,
  expandUserPath,
} from "./project-sources.mjs";

test("parseRepoSource accepts GitHub shorthand and common URL shapes", () => {
  const cases = [
    ["acme/widgets", "https://github.com/acme/widgets.git", "widgets"],
    ["  acme/widgets.git  ", "https://github.com/acme/widgets.git", "widgets"],
    ["github.com/acme/widgets", "https://github.com/acme/widgets", "widgets"],
    ["https://github.com/acme/widgets", "https://github.com/acme/widgets", "widgets"],
    ["https://github.com/acme/widgets.git", "https://github.com/acme/widgets.git", "widgets"],
    ["https://github.com/acme/widgets/", "https://github.com/acme/widgets", "widgets"],
    // A browser URL names the repository, not the branch page.
    ["https://github.com/acme/widgets/tree/main/src", "https://github.com/acme/widgets", "widgets"],
    ["git@github.com:acme/widgets.git", "git@github.com:acme/widgets.git", "widgets"],
    ["ssh://git@git.example.com/team/app.git", "ssh://git@git.example.com/team/app.git", "app"],
    ["https://gitlab.com/group/sub/app.git", "https://gitlab.com/group/sub/app.git", "app"],
  ];
  for (const [input, url, name] of cases) {
    const parsed = parseRepoSource(input);
    assert.equal(parsed.ok, true, `${input}: ${parsed.error}`);
    assert.equal(parsed.url, url, input);
    assert.equal(parsed.name, name, input);
  }
});

test("parseRepoSource refuses anything that is not a remote repository address", () => {
  const refused = [
    "",
    "   ",
    "/home/me/project",
    "./project",
    "../project",
    "file:///tmp/repo",
    "ext::sh -c touch /tmp/pwned",
    "git://github.com/acme/widgets.git",
    "http://example.com/acme/widgets.git",
    "-oProxyCommand=evil@host:repo",
    "--upload-pack=evil",
    "https://user:token@github.com/acme/widgets.git",
    "https://token@github.com/acme/widgets.git",
    "ssh://git:pw@host/acme/widgets.git",
    "https://github.com/acme",
    "github.com/acme",
    "acme/..",
    "acme widgets/repo",
    "https://github.com/acme/widgets\n--upload-pack=x",
    "javascript:alert(1)",
  ];
  for (const input of refused) {
    const parsed = parseRepoSource(input);
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(input)} to be refused`);
    assert.ok(parsed.error);
  }
});

test("folderNameError rejects names that are not a single safe folder", () => {
  for (const ok of ["my-app", "my app", "app.v2", ".dotfiles", "日本語"])
    assert.equal(folderNameError(ok), null, ok);
  const bad = [
    "",
    " ",
    ".",
    "..",
    "a/b",
    "a\\b",
    "../escape",
    "name\0",
    "tab\tname",
    "trailing.",
    " leading",
    "trailing ",
    "a:b",
    "x".repeat(256),
    undefined,
    42,
  ];
  for (const name of bad) assert.ok(folderNameError(name), JSON.stringify(name));
});

test("redactCredentials hides userinfo in URLs but leaves plain text alone", () => {
  assert.equal(
    redactCredentials("fatal: unable to access 'https://user:secret@host/x.git/': 401"),
    "fatal: unable to access 'https://***@host/x.git/': 401",
  );
  assert.equal(
    redactCredentials("git@github.com: Permission denied"),
    "git@github.com: Permission denied",
  );
});

test("expandUserPath expands ~ against the given home and resolves the rest", () => {
  assert.equal(expandUserPath("~/work", "/home/me"), "/home/me/work");
  assert.equal(expandUserPath("  /abs/dir ", "/home/me"), "/abs/dir");
});
