import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { AmanosError } from "../src/errors.js";
import { DEFAULT_CONFIG, parseConfig, readConfig, writeConfig } from "../src/workspace/index.js";
import { workspacePaths } from "../src/workspace/paths.js";
import { makeTempDir } from "./helpers/workspace.js";

const file = "config.json";

describe("parseConfig", () => {
  it("fills in the defaults for an empty config", () => {
    expect(parseConfig(file, "{}")).toEqual(DEFAULT_CONFIG);
  });

  it("keeps explicit values and completes the rest", () => {
    const config = parseConfig(file, JSON.stringify({ quietPeriodSeconds: 5 }));

    expect(config.quietPeriodSeconds).toBe(5);
    expect(config.agent).toBe("codex");
    expect(config.activation).toEqual(DEFAULT_CONFIG.activation);
  });

  it("preserves unknown fields, at the top level and inside activation", () => {
    const config = parseConfig(
      file,
      JSON.stringify({ future: { flag: true }, activation: { later: 1 } }),
    );

    expect(config["future"]).toEqual({ flag: true });
    expect(config.activation["later"]).toBe(1);
    expect(config.activation.defaultStatus).toBe("active");
  });

  it("names the offending field for a wrong value", () => {
    expect(() => parseConfig(file, JSON.stringify({ quietPeriodSeconds: "soon" }))).toThrowError(
      'config.json: "quietPeriodSeconds" must be a whole number between 1 and 86400, found "soon".',
    );
    expect(() =>
      parseConfig(file, JSON.stringify({ activation: { draftBelowConfidence: 140 } })),
    ).toThrowError(/"activation.draftBelowConfidence" must be a whole number between 0 and 100/);
    expect(() =>
      parseConfig(file, JSON.stringify({ activation: { defaultStatus: "maybe" } })),
    ).toThrowError(/"activation.defaultStatus" must be one of: active, draft, blocked, done/);
    expect(() => parseConfig(file, JSON.stringify({ activation: [] }))).toThrowError(
      /"activation" must be an object/,
    );
    expect(() => parseConfig(file, JSON.stringify({ agent: "" }))).toThrowError(
      /"agent" must be a non-empty string/,
    );
  });

  it("explains broken JSON and non-objects without a stacktrace", () => {
    expect(() => parseConfig(file, "{oops")).toThrowError(AmanosError);
    expect(() => parseConfig(file, "{oops")).toThrowError(/config.json is not valid JSON/);
    expect(() => parseConfig(file, "[]")).toThrowError(
      "config.json must contain a JSON object, found an array.",
    );
  });
});

describe("readConfig and writeConfig", () => {
  it("round-trips through the file system", async () => {
    const paths = workspacePaths(await makeTempDir());
    await mkdir(paths.amanosDir);

    await writeConfig(paths);
    expect(await readConfig(paths)).toEqual(DEFAULT_CONFIG);

    await writeConfig(paths, { ...DEFAULT_CONFIG, agent: "claude", extra: "kept" });
    const reread = await readConfig(paths);
    expect(reread.agent).toBe("claude");
    expect(reread["extra"]).toBe("kept");
  });

  it("points at init when the config is missing", async () => {
    const paths = workspacePaths(await makeTempDir());

    await expect(readConfig(paths)).rejects.toThrowError(
      `${paths.config} is missing. Run "amanos init ${paths.root}" to set up the workspace.`,
    );
  });
});
