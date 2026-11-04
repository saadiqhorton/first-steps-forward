# 0005: The agent proposes a dev command, the user approves it once

**Status:** accepted, 2026-11-04.

## Context

ADE's dev-server manager only ran a package.json `scripts.dev`. A project without one (Python,
Go, Rust, or a Node project that starts some other way) could not be started, so the agent could
not open the app in its browser. The agent is told never to start a server itself, and Codex's
sandbox would stop a server it started from listening anyway. A real case: a Python project whose
UI starts with `pyxplain-ui` from its `ui/` folder got "No dev script for this project".

## Decision

`dev_server_start` takes optional `command`, `cwd` (relative to the project root, default `.`)
and `port` (only for an app that always listens on a fixed port). A package.json dev script
still wins exactly as before; a command passed alongside one is ignored, and the response says
so.

Without a dev script, a proposed command is shown to the user as **Run this dev command?** with
the command and folder verbatim. The card appears in the session whose agent asked (the tools
send `ADE_SESSION_ID`, which ADE puts in their environment each turn), so the session shows
**Needs you** like an agent's permission request. When ADE does not know the session, the card
appears in the project's Agent browser pane. The start call waits up to five minutes for the
answer:

- **Allow** stores the command as the project's dev command (`project.devCommand`) and starts
  it. Later starts with no arguments, or with the same command, folder and port, run it with no
  new question.
- **Deny** returns an error telling the agent not to start it another way and to tell the user.
- No answer yet returns a non-error "still waiting" response; the question stays open, and
  calling again with the same command joins it.

There is one open question per project. A different command replaces it, and replaces the
stored command only once approved. Questions are kept in memory and outlive the turn that asked
(the answer is about the project); completing the session, removing the project, or restarting
ADE drops them. The Details rows of the Agent browser pane show the approved command with
**Forget**, which clears it (a running server keeps running; the next start asks again).

## Safety

The command runs outside the agent's sandbox, as the user, so ADE checks it strictly:

- One line, at most 500 characters, split into argv by a small quote-aware splitter and started
  with `shell: false`. Unquoted `&&`, `||`, `|`, `&`, `;`, `<`, `>`, backticks, `$( )` and `$VAR`
  expansions, and a leading `NAME=value`, are refused with a message asking for one program and
  its arguments. `{port}` in an argument becomes the allocated port.
- `cwd` must be relative and resolve, by real path, inside the project's real path, so neither
  `..` nor a symlink can lead out. It is checked again at every start.
- The environment adds only `PORT`, `HOST=127.0.0.1`, and a `.venv/bin` (`.venv\Scripts` on
  Windows) in the command's folder or the project root at the front of `PATH`.
- It launches through the same process plumbing as dev scripts (Windows shims, logs, stop,
  process-tree kill), and `running` is reported only once the port accepts a connection (within
  30 seconds; dev scripts keep 10). A fixed port that is already taken is refused before
  anything starts.

## Consequences

- Any project whose app starts with one command can be opened in the agent browser after one
  click from the user.
- The approval covers the exact program, arguments, folder and port, not what the program does:
  a project script the agent edits later runs with the user's rights at the next start. That is
  the same trust the user already gives a package.json dev script.
- The answer goes through ADE's loopback API, like an agent's permission answers, so an agent
  whose shell can reach that API could answer for the user. Such an agent can already run the
  server itself; the approval adds no power, it keeps the agents that cannot (Codex in its
  sandbox, Claude Code asking before shell commands) from running a server unseen.
- A command that needs a shell (pipes, `&&`, environment assignments) must be wrapped in a
  script in the project, which the user then sees by name in the approval.
- A project with no package.json is now "no dev script" rather than "package.json could not be
  read", so the agent is told to propose a command instead of being stuck.
