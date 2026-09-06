import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { run } from "../src/cli/run.js";
import { scanWorkspace } from "../src/scan/index.js";
import { initWorkspace, parseDecisionFile } from "../src/store/index.js";
import { readState, workspacePaths } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const execFileAsync = promisify(execFile);

function recordingIo(): {
  io: { out: (line: string) => void; err: (line: string) => void };
  lines: string[];
} {
  const lines: string[] = [];
  return { io: { out: (line) => lines.push(line), err: (line) => lines.push(line) }, lines };
}

async function prepareWorkspace(): Promise<{
  root: string;
  paths: ReturnType<typeof workspacePaths>;
}> {
  const root = await makeTempDir();
  const paths = workspacePaths(root);
  await initWorkspace({ paths, io: recordingIo().io });
  await mkdir(join(root, "notes"));
  await writeFile(
    join(root, "notes", "pricing.md"),
    "# Pricing\n\nWe decided the Pro plan costs 29 EUR per month.\n",
    "utf8",
  );
  const repo = join(root, "app-repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await execFileAsync("git", ["init", "--quiet", repo], { windowsHide: true });
  await writeFile(
    join(repo, "src", "pricing.ts"),
    "export const proPrice = { amount: 29, currency: 'EUR' };\n",
    "utf8",
  );
  return { root, paths };
}

describe("amanos scan", () => {
  it("reads notes, appends one decision, records impacts and updates state", async () => {
    const { paths } = await prepareWorkspace();
    const { io, lines } = recordingIo();
    const times = [100, 112];

    const result = await scanWorkspace({ paths, io }, {
      scannedAt: "2026-09-06T12:00:00.000Z",
      now: () => times.shift() ?? 112,
    });
    const decisions = parseDecisionFile(await readFile(paths.decisions, "utf8"));
    const state = await readState(paths);

    expect(result.filesRead).toBe(1);
    expect(result.newDecisions).toBe(1);
    expect(result.newCandidates).toBe(1);
    expect(decisions.decisions).toHaveLength(1);
    expect(decisions.content).toContain("candidate · app-repo/src/pricing.ts");
    expect(state.lastScanAt).toBe("2026-09-06T12:00:00.000Z");
    expect(state.repositories.map(({ path }) => path)).toEqual(["app-repo"]);
    expect(lines).toEqual([
      "Read 1 source file.",
      "Found 1 new decision.",
      "Found 1 new candidate impact.",
      "Completed in 12 ms.",
    ]);
  });

  it("reports a no-op second scan without changing DECISIONS.md", async () => {
    const { paths } = await prepareWorkspace();
    await scanWorkspace({ paths, io: recordingIo().io }, {
      scannedAt: "2026-09-06T12:00:00.000Z",
    });
    const before = await readFile(paths.decisions);
    const { io, lines } = recordingIo();

    const result = await scanWorkspace({ paths, io }, {
      scannedAt: "2026-09-06T12:01:00.000Z",
    });
    const after = await readFile(paths.decisions);

    expect(result.newDecisions).toBe(0);
    expect(result.newCandidates).toBe(0);
    expect(after.equals(before)).toBe(true);
    expect(lines).toContain("No new decisions.");
    expect(lines).toContain("No new candidate impacts.");
  });

  it("previews decisions and candidates through the CLI without writing any file", async () => {
    const { root, paths } = await prepareWorkspace();
    const files = [
      paths.decisions,
      paths.config,
      paths.state,
      join(root, "notes", "pricing.md"),
      join(root, "app-repo", "src", "pricing.ts"),
    ];
    const before = await Promise.all(files.map((file) => readFile(file)));
    const { io, lines } = recordingIo();

    expect(await run(["scan", root, "--dry-run"], io)).toBe(0);
    const after = await Promise.all(files.map((file) => readFile(file)));

    expect(after.every((contents, index) => contents.equals(before[index] as Buffer))).toBe(true);
    expect(parseDecisionFile(after[0]?.toString("utf8") ?? "").decisions).toEqual([]);
    expect(lines).toContain("Dry run: Found 1 new decision.");
    expect(lines).toContain("Dry run: Found 1 new candidate impact.");
    expect(lines).toContain("  would add D-001 from notes/pricing.md#L3");
    expect(lines).toContain("  would add candidate D-001 · app-repo/src/pricing.ts");
  });

  it("stores repository errors with the scan timestamp and keeps the run visible", async () => {
    const root = await makeTempDir();
    const paths = workspacePaths(root);
    await initWorkspace({ paths, io: recordingIo().io });
    await mkdir(join(root, "broken-repo", ".git"), { recursive: true });
    const { io, lines } = recordingIo();

    const result = await scanWorkspace({ paths, io }, {
      scannedAt: "2026-09-06T12:02:00.000Z",
    });
    const state = await readState(paths);

    expect(result.errors).toHaveLength(1);
    expect(state.lastScanAt).toBe("2026-09-06T12:02:00.000Z");
    expect(state.errors).toEqual([
      {
        message: expect.stringContaining("Could not enumerate repository files"),
        path: "broken-repo",
        at: "2026-09-06T12:02:00.000Z",
      },
    ]);
    expect(lines.some((line) => line.startsWith("  error broken-repo:"))).toBe(true);
  });
});
