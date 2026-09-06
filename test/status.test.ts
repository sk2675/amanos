import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { AmanosError } from "../src/errors.js";
import {
  deriveStatus,
  formatStatus,
  readStatus,
  relativeTime,
} from "../src/status/index.js";
import { parseDecisionFile } from "../src/store/decisions.js";
import {
  INITIAL_STATE,
  workspacePaths,
  writeState,
  type WorkspaceState,
} from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const now = Date.parse("2026-09-06T12:02:00.000Z");

function state(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return { ...INITIAL_STATE, ...overrides };
}

function recordingIo(): {
  io: { out: (line: string) => void; err: (line: string) => void };
  lines: string[];
} {
  const lines: string[] = [];
  return { io: { out: (line) => lines.push(line), err: (line) => lines.push(line) }, lines };
}

describe("deriveStatus", () => {
  it("counts decision states, unique candidate impacts and recorded errors", () => {
    const decisions = parseDecisionFile(
      [
        "# Decisions",
        "",
        "## D-001 — Active",
        "",
        "Status: active",
        "",
        "### Auswirkungen",
        "",
        "- [ ] candidate · app/src/one.ts",
        "- [x] candidate · app/src/two.ts",
        "- [ ] candidate · app/src/one.ts",
        "",
        "## D-002 — Draft",
        "",
        "Status: draft",
        "",
        "### Auswirkungen",
        "",
        "- [ ] candidate · app/src/one.ts",
        "",
        "## D-003 — Blocked",
        "",
        "Status: blocked",
        "",
        "## D-004 — Done",
        "",
        "Status: done",
        "",
        "## D-005 — Handwritten unknown status",
        "",
        "Status: paused",
        "",
      ].join("\n"),
    );

    expect(
      deriveStatus(
        decisions,
        state({
          lastScanAt: "2026-09-06T12:00:00.000Z",
          errors: [
            { message: "broken repo", path: "repo", at: "2026-09-06T12:00:00.000Z" },
            { message: "unreadable file", path: "notes/a.md", at: null },
          ],
        }),
      ),
    ).toEqual({
      activeDecisions: 1,
      draftDecisions: 1,
      candidateImpacts: 3,
      blockedChanges: 1,
      lastScanAt: "2026-09-06T12:00:00.000Z",
      errors: 2,
    });
  });
});

describe("relativeTime", () => {
  it("formats minute, hour and day boundaries", () => {
    expect(relativeTime("2026-09-06T12:01:31.000Z", now)).toBe("just now");
    expect(relativeTime("2026-09-06T12:00:00.000Z", now)).toBe("2 minutes ago");
    expect(relativeTime("2026-09-06T11:02:00.000Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-09-04T12:02:00.000Z", now)).toBe("2 days ago");
  });

  it("handles an absent scan and future clock skew", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("2026-09-06T12:03:00.000Z", now)).toBe("just now");
  });
});

describe("formatStatus", () => {
  it("prints drafts and errors only when present", () => {
    expect(
      formatStatus(
        {
          activeDecisions: 3,
          draftDecisions: 2,
          candidateImpacts: 7,
          blockedChanges: 1,
          lastScanAt: "2026-09-06T12:00:00.000Z",
          errors: 2,
        },
        now,
      ),
    ).toEqual([
      "3 active decisions",
      "2 draft decisions",
      "7 candidate impacts",
      "1 blocked change",
      "Last scan: 2 minutes ago",
      "2 errors — see 'amanos scan --verbose'",
    ]);

    expect(
      formatStatus({
        activeDecisions: 0,
        draftDecisions: 0,
        candidateImpacts: 0,
        blockedChanges: 0,
        lastScanAt: null,
        errors: 0,
      }),
    ).toEqual([
      "0 active decisions",
      "0 candidate impacts",
      "0 blocked changes",
      "Last scan: never",
    ]);
  });
});

describe("readStatus", () => {
  it("reads both workspace files and writes the compact report", async () => {
    const paths = workspacePaths(await makeTempDir());
    await mkdir(paths.amanosDir);
    await writeFile(
      paths.decisions,
      "## D-001 — Active\n\nStatus: active\n\n### Auswirkungen\n\n- [ ] candidate · app/a.ts\n",
      "utf8",
    );
    await writeState(paths, {
      ...INITIAL_STATE,
      lastScanAt: "2026-09-06T12:00:00.000Z",
    });
    const { io, lines } = recordingIo();

    const result = await readStatus({ paths, io }, { now: () => now });

    expect(result.activeDecisions).toBe(1);
    expect(result.candidateImpacts).toBe(1);
    expect(lines).toEqual([
      "1 active decision",
      "1 candidate impact",
      "0 blocked changes",
      "Last scan: 2 minutes ago",
    ]);
  });

  it("reports a missing initialization as an expected CLI error", async () => {
    const paths = workspacePaths(await makeTempDir());

    await expect(readStatus({ paths, io: recordingIo().io })).rejects.toMatchObject({
      name: "AmanosError",
      exitCode: 1,
    } satisfies Partial<AmanosError>);
    await expect(readStatus({ paths, io: recordingIo().io })).rejects.toThrowError(
      /Run "amanos init .+" to set up the workspace\./,
    );
  });
});
