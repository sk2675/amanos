import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

import { V1_AGENT_DISABLED_REASON, type AgentRequest } from "../src/agent/index.js";
import { run } from "../src/cli/run.js";
import { scanWorkspace } from "../src/scan/index.js";
import { initWorkspace, parseDecisionFile } from "../src/store/index.js";
import { readState, workspacePaths } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const execFileAsync = promisify(execFile);
const unreadableSource = vi.hoisted(() => ({ path: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: string, options?: unknown) => {
      if (unreadableSource.path !== "" && String(path) === unreadableSource.path) {
        return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      }
      return (actual.readFile as (p: string, o?: unknown) => Promise<unknown>)(path, options);
    },
  };
});

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
    expect(result.agentRuns).toEqual([
      {
        decisionId: "D-001",
        repositoryPath: join(paths.root, "app-repo"),
        result: { kind: "aborted", reason: V1_AGENT_DISABLED_REASON },
      },
    ]);
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

  it("passes the configured adapter name and repository-local context through the scan seam", async () => {
    const { paths } = await prepareWorkspace();
    const configuredNames: string[] = [];
    const requests: AgentRequest[] = [];

    const result = await scanWorkspace({ paths, io: recordingIo().io }, {
      scannedAt: "2026-09-06T12:00:00.000Z",
      agentFactory: (configuredName) => {
        configuredNames.push(configuredName);
        return {
          name: configuredName,
          prepare: (request) => {
            requests.push(request);
            return Promise.resolve({ kind: "aborted", reason: "test adapter" });
          },
        };
      },
    });

    expect(configuredNames).toEqual(["codex"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      decisionId: "D-001",
      repositoryPath: join(paths.root, "app-repo"),
      candidatePaths: ["src/pricing.ts"],
      sources: [
        {
          path: "notes/pricing.md",
          content: "# Pricing\n\nWe decided the Pro plan costs 29 EUR per month.\n",
        },
      ],
    });
    expect(result.agentRuns[0]?.result).toEqual({ kind: "aborted", reason: "test adapter" });
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
    expect(lines).not.toContain(expect.stringContaining("agent"));
    expect(lines).toContain("Dry run: Found 1 new decision.");
    expect(lines).toContain("Dry run: Found 1 new candidate impact.");
    expect(lines).toContain("  would add D-001 from notes/pricing.md#L3");
    expect(lines).toContain("  would add candidate D-001 · app-repo/src/pricing.ts");
  });

  it("keeps a recognized decision when a broken repository fails and exposes the error in status", async () => {
    const root = await makeTempDir();
    const paths = workspacePaths(root);
    await initWorkspace({ paths, io: recordingIo().io });
    await writeFile(
      join(root, "decision.md"),
      "We decided to keep recognized decisions when repository scans fail.\n",
      "utf8",
    );
    await mkdir(join(root, "broken-repo", ".git"), { recursive: true });
    const { io, lines } = recordingIo();

    const result = await scanWorkspace({ paths, io }, {
      scannedAt: "2026-09-06T12:02:00.000Z",
    });
    const state = await readState(paths);
    const decisions = parseDecisionFile(await readFile(paths.decisions, "utf8"));

    expect(result.newDecisions).toBe(1);
    expect(decisions.decisions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(state.lastScanAt).toBe("2026-09-06T12:02:00.000Z");
    expect(state.errors).toEqual([
      {
        message: expect.stringContaining("Could not enumerate repository files"),
        path: "broken-repo",
        at: "2026-09-06T12:02:00.000Z",
      },
    ]);
    expect(lines).toContain("1 error — use --verbose for details.");
    expect(lines.some((line) => line.startsWith("  error broken-repo:"))).toBe(false);

    const verbose = recordingIo();
    expect(await run(["status", root, "--verbose"], verbose.io)).toBe(0);
    expect(verbose.lines).toContain("1 error");
    expect(
      verbose.lines.some((line) =>
        line.startsWith("  error broken-repo at 2026-09-06T12:02:00.000Z:"),
      ),
    ).toBe(true);
  });

  it("continues past an unreadable note and clears the error after recovery", async () => {
    const root = await makeTempDir();
    const paths = workspacePaths(root);
    await initWorkspace({ paths, io: recordingIo().io });
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "readable.md"), "We decided to ship on Monday.\n", "utf8");
    unreadableSource.path = join(root, "notes", "private.md");
    await writeFile(unreadableSource.path, "We decided to launch on Tuesday.\n", "utf8");

    try {
      const firstIo = recordingIo();
      const first = await scanWorkspace({ paths, io: firstIo.io }, {
        scannedAt: "2026-09-06T12:03:00.000Z",
        verbose: true,
      });
      const firstState = await readState(paths);
      const firstDecisions = parseDecisionFile(await readFile(paths.decisions, "utf8"));

      expect(first.filesRead).toBe(1);
      expect(first.newDecisions).toBe(1);
      expect(firstDecisions.decisions.map(({ title }) => title)).toEqual([
        "We decided to ship on Monday.",
      ]);
      expect(firstState.errors).toEqual([
        {
          message: "Could not read source: permission denied",
          path: "notes/private.md",
          at: "2026-09-06T12:03:00.000Z",
        },
      ]);
      expect(firstIo.lines).toContain("1 error.");
      expect(firstIo.lines).toContain(
        "  error notes/private.md: Could not read source: permission denied",
      );

      unreadableSource.path = "";
      const second = await scanWorkspace({ paths, io: recordingIo().io }, {
        scannedAt: "2026-09-06T12:04:00.000Z",
      });
      const secondState = await readState(paths);
      const secondDecisions = parseDecisionFile(await readFile(paths.decisions, "utf8"));

      expect(second.filesRead).toBe(2);
      expect(second.newDecisions).toBe(1);
      expect(secondDecisions.decisions).toHaveLength(2);
      expect(secondState.errors).toEqual([]);
    } finally {
      unreadableSource.path = "";
    }
  });
});
