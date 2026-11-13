import { body } from "../http.mjs";

const decodePackage = (value) => {
  if (typeof value !== "string" || !value) throw new Error("No package data.");
  return Buffer.from(value, "base64");
};

/** `/api/skills/:projectId/*`: list, read, edit, copy and import skills. */
export async function skills(ctx) {
  const { req, res, url, parts, state, json } = ctx;
  if (parts[0] !== "skills") return ctx.handled || res.writableEnded;
  const store = await import("../skills.mjs");
  const github = await import("../github-skills.mjs");
  const githubToken = process.env.ADE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const project = state.projects.find((item) => item.id === parts[1]);
  if (!project) return json(res, 404, { error: "Select an existing project first." });
  const rootId = url.searchParams.get("root") ?? "";
  const folder = url.searchParams.get("skill") ?? "";
  const file = url.searchParams.get("path") ?? "";
  const action = parts.slice(2).join("/");

  try {
    if (!action && req.method === "GET")
      return json(res, 200, { skills: await store.listSkills(project.path) });

    if (action === "raw" && req.method === "GET") {
      const asset = await store.readSkillAsset(project.path, rootId, folder, file);
      res.writeHead(200, {
        "content-type": asset.contentType,
        "content-length": String(asset.bytes.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(asset.bytes);
      return true;
    }

    if (action === "file" && req.method === "GET")
      return json(res, 200, await store.readSkillFile(project.path, rootId, folder, file));

    if (action === "file" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        200,
        await store.writeSkillFile(
          project.path,
          data.rootId ?? rootId,
          data.skill ?? folder,
          data.path ?? file,
          data.content,
          data.version,
        ),
      );
    }

    if (action === "file/create" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        201,
        await store.createSkillFile(
          project.path,
          data.rootId ?? rootId,
          data.skill ?? folder,
          data.path ?? file,
        ),
      );
    }

    if (action === "file/delete" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        200,
        await store.deleteSkillFile(
          project.path,
          data.rootId ?? rootId,
          data.skill ?? folder,
          data.path ?? file,
        ),
      );
    }

    if (action === "skill" && req.method === "POST") {
      const data = await body(req);
      return json(res, 200, await store.saveSkill(project.path, data));
    }

    if (action === "skill/delete" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        200,
        await store.deleteSkill(project.path, data.rootId ?? rootId, data.skill ?? folder),
      );
    }

    if (action === "skill/move" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        200,
        await store.moveSkill(project.path, data.rootId, data.sourceRootId, data.skill ?? folder),
      );
    }

    if (action === "skill/copy" && req.method === "POST") {
      const data = await body(req);
      return json(
        res,
        200,
        await store.copySkill(project.path, data.rootId, data.sourceRootId, data.skill ?? folder),
      );
    }

    if (action === "import/preview" && req.method === "POST") {
      const data = await body(req);
      return json(res, 200, {
        skills: await store.readPackage(decodePackage(data.data)),
      });
    }

    if (action === "github" && req.method === "POST") {
      const data = await body(req);
      const target = github.parseGithubTarget(data.url);
      return json(res, 200, await github.findSkillsInRepo(target, { token: githubToken }));
    }

    if (action === "github/import" && req.method === "POST") {
      const data = await body(req);
      const target = github.parseGithubTarget(data.url);
      const folders = Array.isArray(data.folders) ? data.folders : [];
      if (!folders.length) return json(res, 400, { error: "Choose at least one skill." });
      const found = await github.findSkillsInRepo(target, { token: githubToken });
      const chosen = found.skills.filter((skill) => folders.includes(skill.folder));
      if (!chosen.length)
        return json(res, 404, { error: "Those skills are no longer in that repository." });

      const invalid = chosen.filter((skill) => skill.status === "invalid");
      if (invalid.length)
        return json(res, 400, {
          error: `${invalid[0].folder || "The repository root"} is not a valid skill: ${
            invalid[0].errors[0] ?? "SKILL.md does not follow the format."
          }`,
        });

      const imported = [];
      for (const skill of chosen) {
        const tree = await github.fetchSkillTree(target, skill, {
          token: githubToken,
          branch: found.repo.ref,
        });
        imported.push(
          await store.writeSkillFromFiles(
            project.path,
            { rootId: data.rootId, folder: tree.folder, files: tree.files },
            undefined,
          ),
        );
      }
      return json(res, 200, { skills: imported });
    }

    if (action === "import" && req.method === "POST") {
      const data = await body(req);
      return json(res, 200, {
        skills: await store.importPackage(project.path, {
          rootId: data.rootId,
          bytes: decodePackage(data.data),
        }),
      });
    }
  } catch (error) {
    if (error instanceof store.SkillsError)
      return json(res, error.status, { error: error.message });
    if (error instanceof github.GithubSkillsError)
      return json(res, error.status, { error: error.message });
    if (error?.message === "No package data.")
      return json(res, 400, { error: "Choose a .skill file or a .zip archive." });
    throw error;
  }
  return json(res, 404, { error: "Not found." });
}
