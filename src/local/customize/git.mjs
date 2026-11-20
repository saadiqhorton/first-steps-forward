const IDENTITY = [
  "-c",
  "user.name=ADE",
  "-c",
  "user.email=ade@localhost",
  "-c",
  "commit.gpgsign=false",
];

/** Argv-only git inside the private copy; never shown to users. */
export function createGit({ run, cwd }) {
  const git = (args, options = {}) => run("git", [...IDENTITY, ...args], { cwd, ...options });
  git.must = async (args, options) => {
    const result = await git(args, options);
    if (result.code !== 0)
      throw new Error(
        `git ${args[0]} failed: ${(result.stderr || result.stdout || "").trim().slice(-400)}`,
      );
    return result.stdout.trim();
  };
  return git;
}
