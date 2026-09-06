import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AmanosError } from "../src/errors.js";
import { discoverRepositories } from "../src/repos/index.js";
import { makeTempDir } from "./helpers/workspace.js";

/**
 * Windows has no portable way to make a directory genuinely unreadable, so the
 * failing readdir is simulated. Everything above it is the real walk.
 */
const denied = vi.hoisted(() => ({ path: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: (path: string, options: unknown) => {
      if (denied.path !== "" && String(path) === denied.path) {
        return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      }
      return (actual.readdir as (p: string, o: unknown) => Promise<unknown>)(path, options);
    },
  };
});

/** Creates a directory with a `.git` entry, like `git init` would leave behind. */
async function makeRepo(root: string, ...segments: string[]): Promise<string> {
  const repo = join(root, ...segments);
  await mkdir(join(repo, ".git"), { recursive: true });
  return repo;
}

describe("discoverRepositories", () => {
  it("finds a top level and a nested repository", async () => {
    const root = await makeTempDir();
    await makeRepo(root, "website repo");
    await makeRepo(root, "website repo", "packages", "app repo");
    await mkdir(join(root, "notes"), { recursive: true });

    const { repositories, errors } = await discoverRepositories(root);

    expect(errors).toEqual([]);
    expect(repositories).toEqual([
      {
        path: join(root, "website repo"),
        relativePath: "website repo",
        name: "website repo",
      },
      {
        path: join(root, "website repo", "packages", "app repo"),
        relativePath: "website repo/packages/app repo",
        name: "app repo",
      },
    ]);
  });

  it("treats a .git file as a repository and reports the workspace root as .", async () => {
    const root = await makeTempDir();
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "worktree"), { recursive: true });
    await writeFile(join(root, "worktree", ".git"), "gitdir: ../.git/worktrees/wt\n", "utf8");

    const { repositories } = await discoverRepositories(root);

    expect(repositories.map((repo) => repo.relativePath)).toEqual([".", "worktree"]);
  });

  it("ignores build output folders and never descends into .git", async () => {
    const root = await makeTempDir();
    await makeRepo(root, "repo");
    for (const ignored of [
      "node_modules",
      "dist",
      "build",
      ".amanos",
      ".next",
      ".cache",
      "coverage",
      "vendor",
    ]) {
      await makeRepo(root, "repo", ignored, "hidden repo");
    }
    await makeRepo(root, "repo", ".git", "modules", "submodule");

    const { repositories, errors } = await discoverRepositories(root);

    expect(errors).toEqual([]);
    expect(repositories.map((repo) => repo.relativePath)).toEqual(["repo"]);
  });

  it("records an unreadable folder as an error instead of aborting", async () => {
    const root = await makeTempDir();
    await makeRepo(root, "repo");
    const locked = join(root, "locked");
    await mkdir(locked, { recursive: true });
    denied.path = locked;

    try {
      const { repositories, errors } = await discoverRepositories(root);

      expect(repositories.map((repo) => repo.relativePath)).toEqual(["repo"]);
      expect(errors).toEqual([
        { message: 'Could not read "locked": permission denied', path: "locked" },
      ]);
    } finally {
      denied.path = "";
    }
  });

  it.skipIf(process.platform === "win32")(
    "records a real permission failure without aborting",
    async () => {
      const root = await makeTempDir();
      await makeRepo(root, "repo");
      const locked = join(root, "locked");
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);

      try {
        const { repositories, errors } = await discoverRepositories(root);

        expect(repositories.map((repo) => repo.relativePath)).toEqual(["repo"]);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.path).toBe("locked");
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );

  it("rejects a workspace that cannot be read at all", async () => {
    const root = await makeTempDir();

    await expect(discoverRepositories(join(root, "nope"))).rejects.toThrowError(AmanosError);
  });
});
