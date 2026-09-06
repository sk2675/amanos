import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseDecisions, type Decision } from "../src/parser/index.js";
import {
  DECISIONS_HEADER,
  appendDecisions,
  parseDecisionFile,
  serialiseDecisionFile,
  updateDecisionStatus,
} from "../src/store/index.js";
import {
  INITIAL_STATE,
  readState,
  workspacePaths,
  writeState,
  type WorkspacePaths,
} from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const detectedAt = "2026-09-05T10:00:00.000Z";

function finding(sourcePath: string, statement: string): Decision {
  const [decision] = parseDecisions(sourcePath, `# Decision\n\n${statement}`, { detectedAt });
  if (decision === undefined) throw new Error(`Test input was not a decision: ${statement}`);
  return decision;
}

async function storeWith(content: string, nextDecisionNumber = 1): Promise<WorkspacePaths> {
  const paths = workspacePaths(await makeTempDir());
  await mkdir(paths.amanosDir);
  await writeFile(paths.decisions, content, "utf8");
  await writeState(paths, { ...INITIAL_STATE, nextDecisionNumber });
  return paths;
}

describe("parseDecisionFile", () => {
  it("parses an empty file", () => {
    expect(parseDecisionFile("")).toEqual({
      content: "",
      decisions: [],
      usedIds: [],
      highestDecisionNumber: 0,
    });
  });

  it("reads existing entries and known fields", () => {
    const content = [
      "# Team decisions",
      "",
      "## D-007 — We decided to charge 29 EUR.",
      "",
      "Status: active",
      "Confidence: 87 %",
      "Erkannt: 2026-09-05",
      "Quelle: notes/pricing.md#L42-L58",
      "",
      "### Auswirkungen",
      "",
      "- [x] Handwritten result",
      "",
    ].join("\n");

    const parsed = parseDecisionFile(content);

    expect(parsed.usedIds).toEqual(["D-007"]);
    expect(parsed.highestDecisionNumber).toBe(7);
    expect(parsed.decisions[0]).toMatchObject({
      id: "D-007",
      number: 7,
      title: "We decided to charge 29 EUR.",
      status: "active",
      confidence: 87,
      detectedAt: "2026-09-05",
      source: "notes/pricing.md#L42-L58",
    });
  });

  it("round-trips CRLF and handwritten Markdown byte-identically", () => {
    const content = [
      "# My decisions",
      "",
      "A handwritten preface with  double spaces.",
      "",
      "## D-001 — Custom title",
      "",
      "Status:\tactive  ",
      "Confidence: 91 %",
      "Erkannt: 2026-09-05",
      "Quelle: notes/one.md#L8",
      "",
      "My own paragraph.",
      "- [x] checked by a human",
      "",
    ].join("\r\n");

    expect(serialiseDecisionFile(parseDecisionFile(content))).toBe(content);
  });

  it("reserves IDs from malformed manual headings too", () => {
    const parsed = parseDecisionFile("## D-003\nA heading without a title\n");

    expect(parsed.decisions).toEqual([]);
    expect(parsed.usedIds).toEqual(["D-003"]);
    expect(parsed.highestDecisionNumber).toBe(3);
  });
});

describe("appendDecisions", () => {
  it("writes a finding into an empty file in the documented format", async () => {
    const paths = await storeWith("");
    const decision = finding("notes/pricing.md", "We decided the Pro plan costs 29 EUR.");

    const result = await appendDecisions(paths, [decision]);

    expect(result.appended.map(({ id }) => id)).toEqual(["D-001"]);
    expect(result.skipped).toBe(0);
    expect(await readFile(paths.decisions, "utf8")).toBe(
      [
        "## D-001 — We decided the Pro plan costs 29 EUR.",
        "",
        "Status: active",
        "Confidence: 96 %",
        "Erkannt: 2026-09-05",
        "Quelle: notes/pricing.md#L3",
        "",
        "### Auswirkungen",
        "",
        "- [ ] Noch nicht analysiert",
        "",
      ].join("\n"),
    );
    expect((await readState(paths)).nextDecisionNumber).toBe(2);
  });

  it("appends after existing entries without changing manual notes", async () => {
    const original = [
      DECISIONS_HEADER,
      "## D-004 — We decided to use PostgreSQL.",
      "",
      "Status: active",
      "Confidence: 84 %",
      "Erkannt: 2026-09-04",
      "Quelle: notes/database.md#L9",
      "",
      "### Auswirkungen",
      "",
      "- [x] user checked this",
      "",
      "> Keep this handwritten note exactly as-is.  ",
      "",
    ].join("\n");
    const paths = await storeWith(original, 2);
    const decision = finding("notes/hosting.md", "We decided to deploy on AWS.");

    const result = await appendDecisions(paths, [decision]);
    const updated = await readFile(paths.decisions, "utf8");

    expect(result.appended.map(({ id }) => id)).toEqual(["D-005"]);
    expect(updated.startsWith(original)).toBe(true);
    expect(updated).toContain("> Keep this handwritten note exactly as-is.  \n");
    expect(parseDecisionFile(updated).decisions.map(({ id }) => id)).toEqual(["D-004", "D-005"]);
  });

  it("does not rewrite the file when every finding is already present", async () => {
    const decision = finding("notes/pricing.md", "We decided the Pro plan costs 29 EUR.");
    const paths = await storeWith(DECISIONS_HEADER);
    await appendDecisions(paths, [decision]);
    const before = await readFile(paths.decisions);

    const result = await appendDecisions(paths, [decision]);
    const after = await readFile(paths.decisions);

    expect(result.appended).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(after.equals(before)).toBe(true);
  });

  it("keeps IDs collision-free after an entry was manually deleted", async () => {
    const paths = await storeWith(DECISIONS_HEADER);
    await appendDecisions(paths, [finding("notes/one.md", "We decided to ship on Monday.")]);
    expect((await readState(paths)).nextDecisionNumber).toBe(2);

    // The user removes D-001. The state remains the monotonic high-water mark.
    await writeFile(paths.decisions, DECISIONS_HEADER, "utf8");
    const result = await appendDecisions(
      paths,
      [finding("notes/two.md", "We decided to ship on Tuesday.")],
    );

    expect(result.appended.map(({ id }) => id)).toEqual(["D-002"]);
    expect((await readState(paths)).nextDecisionNumber).toBe(3);
    expect(await readFile(paths.decisions, "utf8")).toContain("## D-002 —");
  });

  it("repairs a stale state counter from IDs still present in the file", async () => {
    const existing = `${DECISIONS_HEADER}\n## D-009 — Manual entry\n`;
    const paths = await storeWith(existing, 1);

    const result = await appendDecisions(
      paths,
      [finding("notes/ten.md", "We decided to release version 10.")],
    );

    expect(result.appended.map(({ id }) => id)).toEqual(["D-010"]);
    expect((await readState(paths)).nextDecisionNumber).toBe(11);
  });
});

describe("updateDecisionStatus", () => {
  it("changes only the Status value and adds a history note", async () => {
    const original = [
      "## D-001 — First",
      "",
      "Status: active",
      "Confidence: 90 %",
      "Erkannt: 2026-09-04",
      "Quelle: notes/one.md#L1",
      "",
      "A user's note that must survive.  ",
      "",
      "## D-002 — Second",
      "",
      "Status: draft",
      "Confidence: 60 %",
      "Erkannt: 2026-09-05",
      "Quelle: notes/two.md#L2",
      "",
    ].join("\r\n");
    const paths = await storeWith(original, 3);

    const result = await updateDecisionStatus(
      paths,
      "D-001",
      "done",
      "2026-09-06T12:00:00.000Z",
    );
    const updated = await readFile(paths.decisions, "utf8");

    expect(result).toEqual({
      id: "D-001",
      previousStatus: "active",
      status: "done",
      changed: true,
    });
    expect(updated).toContain("Status: done\r\n");
    expect(updated).toContain("A user's note that must survive.  \r\n");
    expect(updated).toContain("Hinweis: Status am 2026-09-06 von active auf done geändert.\r\n\r\n## D-002");
    expect(updated).toContain("## D-002 — Second\r\n\r\nStatus: draft");
  });

  it("is byte-identical when the requested status is already set", async () => {
    const original = "## D-001 — First\n\nStatus: active\nHandwritten\n";
    const paths = await storeWith(original, 2);

    const result = await updateDecisionStatus(paths, "D-001", "active", detectedAt);

    expect(result.changed).toBe(false);
    expect(await readFile(paths.decisions, "utf8")).toBe(original);
  });

  it("refuses to invent a missing Status line", async () => {
    const original = "## D-001 — First\n\nHandwritten only\n";
    const paths = await storeWith(original, 2);

    await expect(updateDecisionStatus(paths, "D-001", "done", detectedAt)).rejects.toThrowError(
      /has no Status line/,
    );
    expect(await readFile(paths.decisions, "utf8")).toBe(original);
  });
});
