import test from "node:test";
import assert from "node:assert/strict";
import { loadTerminal } from "./terminal-loader.mjs";

test("the built-in terminal loads when node-pty is available", async () => {
  const terminal = { openTerminal() {} };
  assert.equal(await loadTerminal(async () => terminal), terminal);
});

test("a node-pty load failure is reported as the terminal being unavailable", async () => {
  const failure = new Error("Cannot find package 'node-pty'");
  await assert.rejects(
    loadTerminal(async () => {
      throw failure;
    }),
    {
      message:
        "The built-in terminal is unavailable: node-pty could not be loaded on this platform (Cannot find package 'node-pty'). Everything else in ADE works.",
    },
  );
});
