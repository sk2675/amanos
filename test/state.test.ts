import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { INITIAL_STATE, parseState, readState, writeState } from "../src/workspace/index.js";
import { workspacePaths } from "../src/workspace/paths.js";
import { makeTempDir } from "./helpers/workspace.js";

const file = "state.json";

describe("parseState", () => {
  it("starts from the initial state when fields are missing", () => {
    expect(parseState(file, "{}")).toEqual(INITIAL_STATE);
  });

  it("reads repositories, errors and the running decision number", () => {
    const state = parseState(
      file,
      JSON.stringify({
        lastScanAt: "2026-09-05T10:00:00.000Z",
        nextDecisionNumber: 12,
        repositories: [{ path: "website repo", lastSeenAt: "2026-09-05T10:00:00.000Z" }],
        errors: [{ message: "broken git repo", at: null, path: "app repo" }],
      }),
    );

    expect(state.nextDecisionNumber).toBe(12);
    expect(state.repositories).toEqual([
      { path: "website repo", lastSeenAt: "2026-09-05T10:00:00.000Z" },
    ]);
    expect(state.errors[0]?.message).toBe("broken git repo");
    expect(state.errors[0]?.path).toBe("app repo");
  });

  it("preserves unknown fields on the state and on its entries", () => {
    const state = parseState(
      file,
      JSON.stringify({ future: 1, repositories: [{ path: "a", branch: "main" }] }),
    );

    expect(state["future"]).toBe(1);
    expect(state.repositories[0]?.["branch"]).toBe("main");
    expect(state.repositories[0]?.lastSeenAt).toBeNull();
  });

  it("rejects wrong values with the field path", () => {
    expect(() => parseState(file, JSON.stringify({ nextDecisionNumber: 0 }))).toThrowError(
      'state.json: "nextDecisionNumber" must be a whole number at least 1, found 0.',
    );
    expect(() => parseState(file, JSON.stringify({ lastScanAt: "yesterday" }))).toThrowError(
      /"lastScanAt" must be an ISO 8601 timestamp or null/,
    );
    expect(() => parseState(file, JSON.stringify({ repositories: {} }))).toThrowError(
      /"repositories" must be an array/,
    );
    expect(() => parseState(file, JSON.stringify({ repositories: ["a"] }))).toThrowError(
      /"repositories\[0\]" must be an object/,
    );
    expect(() => parseState(file, JSON.stringify({ errors: [{ at: null }] }))).toThrowError(
      /"errors\[0\].message" must be a non-empty string/,
    );
  });
});

describe("readState and writeState", () => {
  it("round-trips through the file system", async () => {
    const paths = workspacePaths(await makeTempDir());
    await mkdir(paths.amanosDir);

    await writeState(paths);
    expect(await readState(paths)).toEqual(INITIAL_STATE);

    await writeState(paths, { ...INITIAL_STATE, nextDecisionNumber: 4 });
    expect((await readState(paths)).nextDecisionNumber).toBe(4);
  });

  it("points at init when the state is missing", async () => {
    const paths = workspacePaths(await makeTempDir());

    await expect(readState(paths)).rejects.toThrowError(
      `${paths.state} is missing. Run "amanos init ${paths.root}" to set up the workspace.`,
    );
  });
});
