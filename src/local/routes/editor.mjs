import { createReadStream } from "node:fs";
import { body } from "../http.mjs";

function streamMedia({ res, json }, media) {
  const { target, mime, size, range } = media;
  if (range === "unsatisfiable") {
    res.statusCode = 416;
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("content-range", `bytes */${size}`);
    res.setHeader("content-length", 0);
    res.end();
    return true;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const stream = size === 0 ? null : createReadStream(target, { start, end });
  const send = () => {
    res.statusCode = range ? 206 : 200;
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("content-type", mime);
    res.setHeader("content-length", size === 0 ? 0 : end - start + 1);
    if (range) res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
    res.setHeader("last-modified", media.stat.mtime.toUTCString());
    res.setHeader("cache-control", "private, max-age=3600");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  };
  if (!stream) {
    send();
    res.end();
    return true;
  }
  stream.once("error", () => {
    if (!res.headersSent) json(res, 404, { error: "File not found." });
    else res.destroy();
  });
  stream.once("open", () => {
    send();
    stream.pipe(res);
  });
  res.once("close", () => stream.destroy());
  return true;
}

/** `/api/editor/:projectId/*`: browse, search, read and write project files. */
export async function editor(ctx) {
  const { req, res, url, parts, state, json } = ctx;
  if (parts[0] === "editor") {
    const editor = await import("../editor.mjs");
    const project = state.projects.find((item) => item.id === parts[1]);
    if (!project) return json(res, 404, { error: "Select an existing project first." });
    try {
      if (parts.length === 3 && req.method === "GET" && parts[2] === "entries")
        return json(res, 200, {
          entries: await editor.listEditorEntries(project.path, url.searchParams.get("path") ?? ""),
        });
      if (parts.length === 3 && req.method === "GET" && parts[2] === "search")
        return json(res, 200, {
          entries: await editor.searchEditorFiles(project.path, url.searchParams.get("q") ?? "", {
            includeFolders: url.searchParams.get("folders") === "1",
          }),
        });
      if (parts.length === 3 && req.method === "GET" && parts[2] === "file")
        return json(
          res,
          200,
          await editor.readEditorFile(project.path, url.searchParams.get("path") ?? ""),
        );
      if (parts.length === 3 && req.method === "GET" && parts[2] === "previews")
        return json(res, 200, {
          previews: await editor.listEditorPreviews(
            project.path,
            url.searchParams.get("path") ?? "",
          ),
        });
      if (parts.length === 3 && req.method === "GET" && parts[2] === "raw")
        return await streamMedia(
          ctx,
          await editor.openEditorMedia(
            project.path,
            url.searchParams.get("path") ?? "",
            req.headers.range,
          ),
        );
      if (parts.length === 3 && req.method === "GET" && parts[2] === "documents")
        return json(res, 200, { documents: await editor.listDocuments(project.path) });
      if (parts.length === 3 && req.method === "POST" && parts[2] === "file") {
        const data = await body(req);
        return json(
          res,
          200,
          await editor.writeEditorFile(project.path, data.path, data.content, data.version),
        );
      }
      if (parts.length === 3 && req.method === "POST" && parts[2] === "create") {
        const data = await body(req);
        return json(res, 201, await editor.createEditorFile(project.path, data.path));
      }
      if (parts.length === 3 && req.method === "POST" && parts[2] === "delete") {
        const data = await body(req);
        return json(res, 200, await editor.deleteEditorFile(project.path, data.path));
      }
    } catch (error) {
      if (error instanceof editor.EditorError)
        return json(res, error.status, { error: error.message });
      throw error;
    }
    return json(res, 404, { error: "Not found." });
  }
  return ctx.handled || res.writableEnded;
}
