import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AmanosError } from "../src/errors.js";
import { resolveWorkspace, workspacePaths } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

describe("workspacePaths", () => {
  it("derives every amanos path from the root", () => {
    const paths = workspacePaths(join("C:", "my work space"));

    expect(paths.decisions).toBe(join(paths.root, "DECISIONS.md"));
    expect(paths.amanosDir).toBe(join(paths.root, ".amanos"));
    expect(paths.config).toBe(join(paths.amanosDir, "config.json"));
    expect(paths.state).toBe(join(paths.amanosDir, "state.json"));
  });
});

describe("resolveWorkspace", () => {
  it("accepts an existing directory whose path contains spaces", async () => {
    const dir = await makeTempDir();
    const nested = join(dir, "my work space");
    await mkdir(nested);

    const paths = await resolveWorkspace(nested);

    expect(paths.root).toBe(nested);
    expect(paths.config).toBe(join(nested, ".amanos", "config.json"));
  });

  it("rejects a path that does not exist", async () => {
    const dir = await makeTempDir();

    await expect(resolveWorkspace(join(dir, "nope"))).rejects.toThrowError(/does not exist/);
    await expect(resolveWorkspace(join(dir, "nope"))).rejects.toThrowError(AmanosError);
  });

  it("rejects a path that is a file", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "notes.md");
    await writeFile(file, "hi\n");

    await expect(resolveWorkspace(file)).rejects.toThrowError(/is not a directory/);
  });
});
