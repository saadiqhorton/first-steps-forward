# Composer file attachments

**Date:** 2026-10-01<br>
**Product:** ADE (designer ADE workspace)<br>
**Status:** Ready to implement

## Problem

The composer only sends text. The product spec already calls for optionally adding a screenshot when starting a task. Coding agents cannot see images, logs, or reference files unless the user pastes paths by hand.

## Goal

Let a person attach images, screenshots, and other files on a new task or follow-up. ADE stores those files in session storage (not the project tree) and hands them to the local CLI so the agent can actually use them.

## What it looks like

The control lives in `Composer`, used on the new-task screen and in an open session.

- Paperclip button in the composer footer, left of Send. Name: "Attach files".
- Chip row between the textarea and the footer when anything is attached.
- Images show a 40px thumbnail, original filename, and a remove control named "Remove filename".
- Other files show a file icon, filename, and size (for example "24 KB").
- Dragging files over the composer shows a drop overlay: "Drop files to attach".
- Pasting a screenshot into the textarea attaches the image instead of inserting binary garbage.
- Send still requires some text. Attachments are extra context, not a substitute for describing the change.

Thread messages show the same chips under the user's text. Image chips are thumbnails loaded from ADE. Filenames that overflow truncate; the full name is on `title`.

## How files reach the agent

Do not write attachments into the project. They live under `~/.ade/attachments/<id>/` (mode `0700` / files `0600`), same privacy as the rest of ADE data.

Flow:

1. On send, the client uploads each draft file to `POST /api/attachments` (JSON with base64 body; utf8-safe through the existing API wrapper).
2. Session create and follow-up accept `attachmentIds`.
3. The user-visible message keeps the typed text plus attachment metadata (id, name, mime, size, kind). It does not dump absolute paths into the bubble.
4. The CLI prompt gets a short appendix listing each file's absolute path and telling the agent to read them, not copy them into the repo unless asked.
5. Native CLI flags are also passed:
   - Codex: `--image <path>` for image attachments (`codex exec` and `codex exec resume`).
   - OpenCode: `--file <path>` for every attachment.
   - Pi: `@<absolute-path>` argv entries before the prompt, plus the path appendix so the `read` tool still works.

## Limits

- 8 files per send
- 10 MiB per file
- 20 MiB total per send
- Empty files rejected
- Filename: basename only, max 200 characters, no path separators or NULs

These sit inside ADE, not the project, so they never appear as uncommitted work.

## Out of scope

- Cloud object storage or ADE-hosted relays
- Editing or annotating images
- Auto-adding `.gitignore` entries
- Native Arc `file-upload` / `file-dropzone` blocks (those are page-level flows; this is a compact composer control matching existing ADE tokens)
- Changing agent sandbox policy beyond the documented flags above
