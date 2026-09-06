import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { scanImpacts } from "../src/impact/index.js";
import { parseDecisions } from "../src/parser/index.js";
import { appendDecisions, initWorkspace } from "../src/store/index.js";
import { readState, workspacePaths } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const execFileAsync = promisify(execFile);
const scannedAt = "2026-09-06T12:00:00.000Z";

function recordingIo(): {
  io: { out: (line: string) => void; err: (line: string) => void };
  lines: string[];
} {
  const lines: string[] = [];
  return { io: { out: (line) => lines.push(line), err: (line) => lines.push(line) }, lines };
}

async function makeGitRepo(root: string, name: string): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", path], { windowsHide: true });
  return path;
}

describe("scanImpacts", () => {
  it("finds candidates in two repos, respects .gitignore and keeps checked candidates", async () => {
    const root = await makeTempDir();
    const paths = workspacePaths(root);
    const { io, lines } = recordingIo();
    await initWorkspace({ paths, io });

    const website = await makeGitRepo(root, "website-repo");
    const app = await makeGitRepo(root, "app-repo");
    await mkdir(join(website, "src"), { recursive: true });
    await mkdir(join(website, "ignored"), { recursive: true });
    await mkdir(join(app, "config"), { recursive: true });
    await writeFile(join(website, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(
      join(website, "src", "pricing.tsx"),
      "export const proPrice = 29; // EUR per month\n",
      "utf8",
    );
    await writeFile(
      join(website, "ignored", "generated.ts"),
      "export const proPrice = 29;\n",
      "utf8",
    );
    await writeFile(
      join(app, "config", "plans.ts"),
      "export const proPlan = { monthlyPrice: 29, currency: 'EUR' };\n",
      "utf8",
    );
    await writeFile(join(app, "README.md"), "Internal application documentation.\n", "utf8");

    const [decision] = parseDecisions(
      "notes/pricing.md",
      "# Pricing\n\nWe decided the Pro plan costs 29 EUR per month.",
      { detectedAt: scannedAt },
    );
    if (decision === undefined) throw new Error("Expected the pricing fixture to be a decision.");
    await appendDecisions(paths, [decision]);

    const first = await scanImpacts({ paths, io }, scannedAt);
    const firstContent = await readFile(paths.decisions, "utf8");
    const candidateLines = firstContent.match(/^- \[[ x]\] candidate · .+$/gm) ?? [];

    expect(first.errors).toEqual([]);
    expect(first.repositories).toBe(2);
    expect(candidateLines).toHaveLength(2);
    expect(candidateLines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("app-repo/config/plans.ts"),
        expect.stringContaining("website-repo/src/pricing.tsx"),
      ]),
    );
    expect(candidateLines.every((line) => line.startsWith("- [ ] candidate · "))).toBe(true);
    expect(firstContent).not.toContain("ignored/generated.ts");

    const checked = firstContent.replace("- [ ] candidate ·", "- [x] candidate ·");
    await writeFile(paths.decisions, checked, "utf8");
    await writeFile(
      join(website, "src", "checkout.ts"),
      "export const proCheckout = { amount: 29, currency: 'EUR' };\n",
      "utf8",
    );
    const second = await scanImpacts({ paths, io }, "2026-09-06T12:01:00.000Z");
    const secondContent = await readFile(paths.decisions, "utf8");

    expect(second.added).toBe(1);
    expect(secondContent.match(/^- \[[ x]\] candidate · .+$/gm)).toHaveLength(3);
    expect(secondContent).toContain("- [x] candidate ·");

    const third = await scanImpacts({ paths, io }, "2026-09-06T12:02:00.000Z");
    const thirdContent = await readFile(paths.decisions, "utf8");
    expect(third.added).toBe(0);
    expect(thirdContent.match(/^- \[[ x]\] candidate · .+$/gm)).toHaveLength(3);
    expect((await readState(paths)).repositories.map(({ path }) => path)).toEqual([
      "app-repo",
      "website-repo",
    ]);
    expect(lines).toContain("Found 2 candidate impacts (2 newly recorded).");
  });
});
