import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { run } from "../src/cli/run.js";
import { parseDecisionFile } from "../src/store/index.js";
import { startWorkspaceWatcher } from "../src/watcher/index.js";
import { workspacePaths, type Workspace } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

const execFileAsync = promisify(execFile);

function recordingWorkspace(root: string): { workspace: Workspace; lines: string[] } {
  const lines: string[] = [];
  return {
    workspace: {
      paths: workspacePaths(root),
      io: { out: (line) => lines.push(line), err: (line) => lines.push(line) },
    },
    lines,
  };
}

async function createRepository(
  root: string,
  name: string,
  path: string,
  content: string,
): Promise<string> {
  const repository = join(root, name);
  const file = join(repository, path);
  await mkdir(dirname(file), { recursive: true });
  await execFileAsync("git", ["init", "--quiet", repository], { windowsHide: true });
  await writeFile(file, content, "utf8");
  await execFileAsync("git", ["-C", repository, "add", "--", path], { windowsHide: true });
  await execFileAsync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Amanos Test",
      "-c",
      "user.email=amanos@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Initial fixture",
    ],
    { windowsHide: true },
  );
  return repository;
}

async function gitStatus(repository: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repository, "status", "--porcelain=v1", "--untracked-files=all"],
    { windowsHide: true },
  );
  return stdout;
}

async function withTimeout(promise: Promise<void>, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out waiting for the watcher scan to finish.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("V1 end to end", () => {
  it("records bilingual decisions and impacts from two repos without changing either repo", async () => {
    const root = await makeTempDir();
    const website = await createRepository(
      root,
      "website",
      "src/pricing.html",
      "<p>The Pro Tarif costs 29 EUR per Monat. Process Pro plan subscriptions with Stripe.</p>\n",
    );
    const app = await createRepository(
      root,
      "app",
      "src/billing.ts",
      "export const billing = 'Pro Tarif 29 EUR Monat; process Pro plan subscriptions with Stripe';\n",
    );

    expect(await Promise.all([gitStatus(website), gitStatus(app)])).toEqual(["", ""]);

    const init = recordingWorkspace(root);
    expect(await run(["init", root], init.workspace.io)).toBe(0);

    const note = join(root, "notes", "pricing.md");
    await mkdir(dirname(note), { recursive: true });
    await writeFile(
      note,
      [
        "# Pricing",
        "",
        "- Wir haben entschieden, dass der Pro-Tarif 29 EUR pro Monat kostet.",
        "- We decided to process Pro plan subscriptions with Stripe.",
        "",
      ].join("\n"),
      "utf8",
    );

    const scan = recordingWorkspace(root);
    expect(await run(["scan", root], scan.workspace.io)).toBe(0);

    const paths = workspacePaths(root);
    const decisionFile = parseDecisionFile(await readFile(paths.decisions, "utf8"));
    expect(decisionFile.decisions.map(({ source }) => source)).toEqual([
      "notes/pricing.md#L3",
      "notes/pricing.md#L4",
    ]);
    expect(decisionFile.decisions).toHaveLength(2);
    for (const decision of decisionFile.decisions) {
      const block = decisionFile.content.slice(decision.start, decision.end);
      expect(block).toContain("candidate · app/src/billing.ts");
      expect(block).toContain("candidate · website/src/pricing.html");
    }

    const status = recordingWorkspace(root);
    expect(await run(["status", root], status.workspace.io)).toBe(0);
    expect(status.lines).toEqual([
      "2 active decisions",
      "4 candidate impacts",
      "0 blocked changes",
      "Last scan: just now",
    ]);

    const config = JSON.parse(await readFile(paths.config, "utf8")) as Record<string, unknown>;
    await writeFile(
      paths.config,
      `${JSON.stringify({ ...config, quietPeriodSeconds: 1 }, null, 2)}\n`,
      "utf8",
    );

    const watched = recordingWorkspace(root);
    let scanFinished: (() => void) | undefined;
    let scanFailed: ((error: unknown) => void) | undefined;
    const completedScan = new Promise<void>((resolve, reject) => {
      scanFinished = resolve;
      scanFailed = reject;
    });
    const watcher = await startWorkspaceWatcher(watched.workspace, {
      onEvent: (event) => {
        if (event.type === "scan-finished") scanFinished?.();
        if (event.type === "scan-failed") scanFailed?.(event.error);
      },
    });
    try {
      await appendFile(
        note,
        "- We have decided Stripe invoices renew every 12 months.\n",
        "utf8",
      );
      await withTimeout(completedScan);
    } finally {
      await watcher.close();
    }

    const afterWatch = parseDecisionFile(await readFile(paths.decisions, "utf8"));
    expect(afterWatch.decisions).toHaveLength(3);
    expect(afterWatch.decisions[2]?.source).toBe("notes/pricing.md#L5");
    expect(watched.lines).toContain("Scan started.");
    expect(
      watched.lines.some((line) => line.startsWith("Scan finished: 1 new decision,")),
    ).toBe(true);
    expect(await Promise.all([gitStatus(website), gitStatus(app)])).toEqual(["", ""]);
  }, 20_000);
});
