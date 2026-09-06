import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli/args.js";
import { UsageError } from "../src/errors.js";

describe("parseArgs", () => {
  it("returns help without arguments and for --help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["scan", "-h"])).toEqual({ kind: "help" });
  });

  it("parses each command with its workspace", () => {
    for (const command of ["init", "scan", "watch", "status"]) {
      expect(parseArgs([command, "./ws"])).toEqual({
        kind: "command",
        command,
        workspace: "./ws",
      });
    }
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["nope", "./ws"])).toThrowError(UsageError);
  });

  it("rejects a missing workspace argument", () => {
    expect(() => parseArgs(["scan"])).toThrowError(/Missing <workspace>/);
  });

  it("rejects extra arguments", () => {
    expect(() => parseArgs(["scan", "./a", "./b"])).toThrowError(/Too many arguments/);
  });
});
