import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeFileAtomic, writeJsonAtomic } from "../src/atomic.js";
import { AmanosError } from "../src/errors.js";
import { makeTempDir } from "./helpers/workspace.js";

describe("writeFileAtomic", () => {
  it("creates and replaces files, including in paths with spaces", async () => {
    const dir = await makeTempDir();
    const target = join(dir, "my notes", "DECISIONS.md");
    await mkdir(join(dir, "my notes"));

    await writeFileAtomic(target, "first\n");
    expect(await readFile(target, "utf8")).toBe("first\n");

    await writeFileAtomic(target, "second\n");
    expect(await readFile(target, "utf8")).toBe("second\n");
    expect(await readdir(join(dir, "my notes"))).toEqual(["DECISIONS.md"]);
  });

  it("leaves the target untouched and removes the temp file when the write fails", async () => {
    const dir = await makeTempDir();
    const target = join(dir, "occupied");
    await mkdir(target);
    await writeFile(join(target, "keep me.txt"), "still here\n");

    await expect(writeFileAtomic(target, "new contents")).rejects.toThrowError(AmanosError);

    expect(await readdir(target)).toEqual(["keep me.txt"]);
    expect(await readdir(dir)).toEqual(["occupied"]);
  });
});

describe("writeJsonAtomic", () => {
  it("writes pretty JSON with a trailing newline", async () => {
    const dir = await makeTempDir();
    const target = join(dir, "config.json");

    await writeJsonAtomic(target, { agent: "codex" });

    expect(await readFile(target, "utf8")).toBe('{\n  "agent": "codex"\n}\n');
  });

  it("keeps the existing file when the value cannot be serialised", async () => {
    const dir = await makeTempDir();
    const target = join(dir, "config.json");
    await writeFileAtomic(target, "original\n");

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await expect(writeJsonAtomic(target, circular)).rejects.toThrowError(/Could not serialise/);

    expect(await readFile(target, "utf8")).toBe("original\n");
    expect(await readdir(dir)).toEqual(["config.json"]);
  });
});
