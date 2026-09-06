import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { run } from "../src/cli/run.js";
import { DECISIONS_HEADER, initWorkspace } from "../src/store/index.js";
import { DEFAULT_CONFIG, INITIAL_STATE, readConfig, readState } from "../src/workspace/index.js";
import { workspacePaths } from "../src/workspace/paths.js";
import { makeTempDir } from "./helpers/workspace.js";

/** Collects terminal output so the reported outcomes can be asserted on. */
function recordingIo(): { io: { out: (line: string) => void; err: (line: string) => void }; lines: string[] } {
  const lines: string[] = [];
  return { io: { out: (line) => lines.push(line), err: (line) => lines.push(line) }, lines };
}

describe("amanos init", () => {
  it("creates the three artefacts with valid defaults in an empty folder", async () => {
    const paths = workspacePaths(await makeTempDir());
    const { io, lines } = recordingIo();

    const results = await initWorkspace({ paths, io });

    expect(results.map((result) => result.outcome)).toEqual(["created", "created", "created"]);
    expect(await readFile(paths.decisions, "utf8")).toBe(DECISIONS_HEADER);
    expect(await readConfig(paths)).toEqual(DEFAULT_CONFIG);
    expect(await readState(paths)).toEqual(INITIAL_STATE);
    expect(lines).toEqual([
      "  created DECISIONS.md",
      "  created .amanos/config.json",
      "  created .amanos/state.json",
      `Initialised the amanos workspace in ${paths.root}.`,
    ]);
  });

  it("leaves an existing DECISIONS.md byte-identical and only adds what is missing", async () => {
    const paths = workspacePaths(await makeTempDir());
    await initWorkspace({ paths, io: recordingIo().io });

    const handwritten = `${DECISIONS_HEADER}\n## D-001 — Pro plan costs 29 €\n`;
    await writeFile(paths.decisions, handwritten, "utf8");
    await writeFile(paths.config, '{ "agent": "claude" }\n', "utf8");

    const { io, lines } = recordingIo();
    const results = await initWorkspace({ paths, io });

    expect(results.map((result) => result.outcome)).toEqual(["exists", "exists", "exists"]);
    expect(await readFile(paths.decisions, "utf8")).toBe(handwritten);
    expect(await readFile(paths.config, "utf8")).toBe('{ "agent": "claude" }\n');
    expect(lines.at(-1)).toBe(`Workspace ${paths.root} is up to date (0 created, 3 kept).`);
  });

  it("completes a partially initialised workspace", async () => {
    const paths = workspacePaths(await makeTempDir());
    await writeFile(paths.decisions, "# My own notes\n", "utf8");

    const { io, lines } = recordingIo();
    const results = await initWorkspace({ paths, io });

    expect(results.map((result) => result.outcome)).toEqual(["exists", "created", "created"]);
    expect(await readFile(paths.decisions, "utf8")).toBe("# My own notes\n");
    expect(await readState(paths)).toEqual(INITIAL_STATE);
    expect(lines.at(-1)).toBe(`Workspace ${paths.root} is up to date (2 created, 1 kept).`);
  });

  it("runs end to end through the CLI, including a path with a space", async () => {
    const root = await makeTempDir();
    const { io, lines } = recordingIo();

    expect(await run(["init", root], io)).toBe(0);

    expect(root).toContain(" ");
    const paths = workspacePaths(root);
    expect(await readConfig(paths)).toEqual(DEFAULT_CONFIG);
    expect(lines.at(-1)).toBe(`Initialised the amanos workspace in ${paths.root}.`);
  });

  it("refuses a workspace that does not exist", async () => {
    const missing = `${await makeTempDir()}/nope`;

    await expect(run(["init", missing], recordingIo().io)).rejects.toThrowError(/does not exist/);
  });
});
