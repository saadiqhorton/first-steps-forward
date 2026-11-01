/** Route module. Dependencies are supplied by the request context. */
export async function editor(ctx) {
  const { req, res, url, parts, path, state, id, json, body } = ctx;
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
          entries: await editor.searchEditorFiles(project.path, url.searchParams.get("q") ?? ""),
        });
      if (parts.length === 3 && req.method === "GET" && parts[2] === "file")
        return json(
          res,
          200,
          await editor.readEditorFile(project.path, url.searchParams.get("path") ?? ""),
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
