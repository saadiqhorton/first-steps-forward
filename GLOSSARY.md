# ADE

ADE is a local workspace for coding-agent CLIs: you add a project, give an agent a task, watch it work, and review what it changed. Everything runs on your machine.

## Work

**Project**:
A folder on this machine that ADE works in, usually a Git repository.
_Avoid_: workspace, repo (when you mean the project)

**Session**:
One task given to an agent in a project, with everything that happened while working on it: messages, turns, changes and checks.
_Avoid_: conversation, task, chat (in code; "conversation" is UI wording only)

**Turn**:
One run of an agent for one prompt, from the moment the agent starts until it exits.
_Avoid_: run, step, job

**Session status**:
Where a session stands: working, verifying, ready, blocked, stopped or complete.
_Avoid_: state (alone)

**Follow-up**:
A message sent to a session after its first turn. It waits while a turn is running, or can replace the running turn ("send now").
_Avoid_: steer, reply

**Baseline**:
The files that already had uncommitted changes when a turn started; they are the user's, not the agent's.
_Avoid_: pre-existing changes, dirty files

**Checks**:
The project's own scripts (typecheck, lint, test, e2e, build) that ADE runs on request to verify a session's changes.
_Avoid_: verification, CI

**Context manifest**:
What ADE tells the agent about the project at the start of every turn: task, branch, dev server, constraints and candidate files.
_Avoid_: context, preamble

## Agents

**Agent**:
A coding-agent CLI installed on this machine that ADE can run, such as Codex, OpenCode, Pi or Claude Code.
_Avoid_: harness, CLI (when you mean the agent), model

**Agent adapter**:
Everything ADE knows about one agent: how to detect it, sign in, list its models and run a turn with it.
_Avoid_: preset, driver, integration

**Session event**:
One thing that happened during a turn, as ADE understands it regardless of agent: agent text, a tool call, an error, a permission request.
_Avoid_: log line

**Permission request**:
A question the agent asks before acting, answered by the user with one of the options the agent offered.
_Avoid_: approval, prompt

**Model listing**:
The models an agent reports it can use, read from the agent itself.
_Avoid_: catalog, model list (in code)

## Browser and dev server

**Agent browser**:
The headless Chrome on this machine that an agent drives to look at and test the project, and that the user can watch and take control of.
_Avoid_: agent computer, preview

**Dev server**:
The project's own development server, started and stopped by ADE on the agent's or user's behalf.
_Avoid_: preview server, process
