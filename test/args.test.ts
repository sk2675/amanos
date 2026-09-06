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

  it("parses --dry-run for scan before or after the workspace", () => {
    expect(parseArgs(["scan", "--dry-run", "./ws"])).toEqual({
      kind: "command",
      command: "scan",
      workspace: "./ws",
      dryRun: true,
    });
    expect(parseArgs(["scan", "./ws", "--dry-run"])).toEqual({
      kind: "command",
      command: "scan",
      workspace: "./ws",
      dryRun: true,
    });
  });

  it("parses --verbose for scan and status", () => {
    expect(parseArgs(["scan", "--verbose", "./ws", "--dry-run"])).toEqual({
      kind: "command",
      command: "scan",
      workspace: "./ws",
      dryRun: true,
      verbose: true,
    });
    expect(parseArgs(["status", "./ws", "--verbose"])).toEqual({
      kind: "command",
      command: "status",
      workspace: "./ws",
      verbose: true,
    });
  });

  it("rejects --dry-run for other commands", () => {
    expect(() => parseArgs(["init", "./ws", "--dry-run"])).toThrowError(
      /only available for "scan"/,
    );
  });

  it("rejects --verbose for commands without recoverable scan errors", () => {
    expect(() => parseArgs(["watch", "./ws", "--verbose"])).toThrowError(
      /only available for "scan" and "status"/,
    );
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
