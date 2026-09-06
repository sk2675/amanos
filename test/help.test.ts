import { describe, expect, it } from "vitest";

import { COMMAND_NAMES, helpText } from "../src/cli/help.js";

describe("helpText", () => {
  it("lists all four V1 commands with a description", () => {
    const text = helpText();
    expect(COMMAND_NAMES).toEqual(["init", "scan", "watch", "status"]);
    for (const name of COMMAND_NAMES) {
      expect(text).toContain(`${name} <workspace>`);
    }
    expect(text).toContain("Watch the workspace");
    expect(text).toContain("--dry-run");
    expect(text).toContain("--verbose");
  });
});
