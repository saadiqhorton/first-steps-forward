import test from "node:test";
import assert from "node:assert/strict";
import {
  APPARMOR_PROFILE,
  APPARMOR_PROFILE_PATH,
  diagnoseLaunchFailure,
  missingLibraries,
  sandboxBlocked,
  sandboxDisabled,
  SETUP_COMMAND,
} from "./browser-host.mjs";

const fakeRun = (outputs) => async (command, args) => outputs[`${command} ${args.join(" ")}`] ?? "";
const EXE = "/home/u/.ade/tools/chrome-headless-shell/linux64/154/chrome-headless-shell";

test("missing libraries come from ldd only after the browser's own loader fails", async () => {
  assert.deepEqual(
    await missingLibraries(EXE, fakeRun({ [`${EXE} --version`]: "Chrome 154" })),
    [],
  );
  const run = fakeRun({
    [`${EXE} --version`]:
      "chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file",
    [`ldd ${EXE}`]:
      "\tlibnss3.so => not found\n\tlibgbm.so.1 => not found\n\tlibc.so.6 => /lib/libc.so.6\n",
  });
  assert.deepEqual(await missingLibraries(EXE, run), ["libnss3.so", "libgbm.so.1"]);
  // ldd may list nothing (nix-ld); the loader's own answer still names one.
  const loaderOnly = fakeRun({
    [`${EXE} --version`]: "error while loading shared libraries: libnss3.so: cannot open",
  });
  assert.deepEqual(await missingLibraries(EXE, loaderOnly), ["libnss3.so"]);
});

test("a sandbox failure reads as AppArmor for users and as root for root", async () => {
  const cause = new Error("browserType.launch: No usable sandbox! ...");
  const user = await diagnoseLaunchFailure({
    executable: EXE,
    cause,
    platform: "linux",
    uid: 1000,
  });
  assert.equal(user.code, "browser_sandbox_blocked");
  assert.equal(user.setupCommand, SETUP_COMMAND);
  const root = await diagnoseLaunchFailure({ executable: EXE, cause, platform: "linux", uid: 0 });
  assert.equal(root.code, "browser_root");
  assert.match(root.message, /ADE_BROWSER_SANDBOX=0/);
});

test("other launch failures name missing libraries on Linux and stay as they are elsewhere", async () => {
  const run = fakeRun({
    [`${EXE} --version`]: "error while loading shared libraries: libgbm.so.1: cannot open",
    [`ldd ${EXE}`]: "\tlibgbm.so.1 => not found\n",
  });
  const cause = new Error("Target page, context or browser has been closed");
  const linux = await diagnoseLaunchFailure({ executable: EXE, cause, platform: "linux", run });
  assert.equal(linux.code, "browser_libraries_missing");
  assert.deepEqual(linux.libraries, ["libgbm.so.1"]);
  assert.match(linux.message, /npm run browser:setup/);
  assert.equal(
    await diagnoseLaunchFailure({ executable: EXE, cause, platform: "darwin", run }),
    undefined,
  );
  const healthy = fakeRun({ [`${EXE} --version`]: "Chrome 154" });
  assert.equal(
    await diagnoseLaunchFailure({ executable: EXE, cause, platform: "linux", run: healthy }),
    undefined,
  );
});

test("the sandbox counts as blocked only under the userns restriction without ADE's profile", async () => {
  const files = (map) => async (file) => {
    if (file in map) return map[file];
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  const restriction = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
  assert.equal(await sandboxBlocked({ platform: "darwin" }), false);
  assert.equal(await sandboxBlocked({ platform: "linux", readFile: files({}) }), false);
  assert.equal(
    await sandboxBlocked({ platform: "linux", readFile: files({ [restriction]: "0\n" }) }),
    false,
  );
  assert.equal(
    await sandboxBlocked({ platform: "linux", readFile: files({ [restriction]: "1\n" }) }),
    true,
  );
  assert.equal(
    await sandboxBlocked({
      platform: "linux",
      readFile: files({ [restriction]: "1\n", [APPARMOR_PROFILE_PATH]: APPARMOR_PROFILE }),
    }),
    false,
  );
});

test("the AppArmor profile matches the installed headless shell and only an explicit opt-out unsandboxes", () => {
  assert.match(
    APPARMOR_PROFILE,
    /\/\*\*\/tools\/chrome-headless-shell\/\*\/\*\/chrome-headless-shell/,
  );
  assert.match(APPARMOR_PROFILE, /userns,/);
  assert.equal(sandboxDisabled({ ADE_BROWSER_SANDBOX: "0" }), true);
  assert.equal(sandboxDisabled({ ADE_BROWSER_SANDBOX: "false" }), false);
  assert.equal(sandboxDisabled({}), false);
});
