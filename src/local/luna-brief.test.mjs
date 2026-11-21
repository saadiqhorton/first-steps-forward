import test from "node:test";
import assert from "node:assert/strict";
import { lunaBrief } from "./luna-brief.mjs";

test("work brief names the folder and allows edits there", () => {
  const brief = lunaBrief({ mode: "work", folder: "/home/me/.ade/luna/t1" });
  assert.match(brief, /You are Luna/);
  assert.match(brief, /\/home\/me\/\.ade\/luna\/t1/);
  assert.match(brief, /create and edit files/);
});

test("chat brief is read-only and does not claim the folder is writable", () => {
  const brief = lunaBrief({ mode: "chat", folder: "/home/me/.ade/luna" });
  assert.match(brief, /read-only/);
  assert.doesNotMatch(brief, /create and edit files/);
});

test("both modes keep the folder boundary and the approval rule", () => {
  for (const mode of ["chat", "work"]) {
    const brief = lunaBrief({ mode, folder: "/tmp/x" });
    assert.match(brief, /outside that one/);
    assert.match(brief, /owner's approval/);
    assert.match(brief, /Report failures/);
  }
});
