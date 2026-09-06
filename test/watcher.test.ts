import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { initWorkspace } from "../src/store/index.js";
import {
  isRelevantWatchPath,
  startWorkspaceWatcher,
  WATCH_LOCK_FILE_NAME,
  type WatchEvent,
} from "../src/watcher/index.js";
import { workspacePaths, type Workspace } from "../src/workspace/index.js";
import { makeTempDir } from "./helpers/workspace.js";

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

async function preparedWorkspace(): Promise<{ workspace: Workspace; lines: string[] }> {
  const root = await makeTempDir();
  const recorded = recordingWorkspace(root);
  await initWorkspace(recorded.workspace);
  recorded.lines.splice(0);
  return recorded;
}

async function waitUntil(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for watcher event.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}

describe("workspace watcher", () => {
  it("filters supported nested sources and all owned or ignored paths", async () => {
    const { workspace } = await preparedWorkspace();

    expect(isRelevantWatchPath(workspace, "notes/meeting.md")).toBe(true);
    expect(isRelevantWatchPath(workspace, "notes/archive/decision.MARKDOWN")).toBe(true);
    expect(isRelevantWatchPath(workspace, "brief.HTML")).toBe(true);
    expect(isRelevantWatchPath(workspace, "notes/image.png")).toBe(false);
    expect(isRelevantWatchPath(workspace, "node_modules/pkg/readme.md")).toBe(false);
    expect(isRelevantWatchPath(workspace, ".git/COMMIT_EDITMSG.txt")).toBe(false);
    expect(isRelevantWatchPath(workspace, ".pytest_cache/note.txt")).toBe(false);
    expect(isRelevantWatchPath(workspace, workspace.paths.decisions)).toBe(false);
    expect(isRelevantWatchPath(workspace, join(workspace.paths.root, "..", "outside.md"))).toBe(false);
  });

  it("uses quietPeriodSeconds from the workspace config", async () => {
    const { workspace } = await preparedWorkspace();
    await writeFile(workspace.paths.config, JSON.stringify({ quietPeriodSeconds: 3 }));
    const events: WatchEvent[] = [];

    const watcher = await startWorkspaceWatcher(workspace, {
      scan: async () => undefined,
      onEvent: (event) => events.push(event),
    });
    try {
      expect(events[0]).toEqual({ type: "ready", quietPeriodMs: 3_000 });
    } finally {
      await watcher.close();
    }
  });

  it("debounces several quick recursive changes into exactly one scan", async () => {
    const { workspace, lines } = await preparedWorkspace();
    const notes = join(workspace.paths.root, "notes", "nested");
    await mkdir(notes, { recursive: true });
    let scans = 0;
    const events: WatchEvent[] = [];
    const watcher = await startWorkspaceWatcher(workspace, {
      quietPeriodMilliseconds: 80,
      scan: async () => {
        scans += 1;
      },
      onEvent: (event) => events.push(event),
    });

    try {
      const note = join(notes, "decision.md");
      await writeFile(note, "first\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(note, "second\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(note, "third\n");

      await waitUntil(() => scans === 1);
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(scans).toBe(1);
      expect(events.filter(({ type }) => type === "change").length).toBeGreaterThanOrEqual(3);
      expect(lines.some((line) => line.includes("Waiting 80 ms"))).toBe(true);
      expect(lines).toContain("Scan started.");
      expect(lines).toContain("Scan finished.");
    } finally {
      await watcher.close();
    }
  });

  it("allows only one watcher per workspace", async () => {
    const { workspace } = await preparedWorkspace();
    const first = await startWorkspaceWatcher(workspace, { scan: async () => undefined });

    try {
      await expect(
        startWorkspaceWatcher(workspace, { scan: async () => undefined }),
      ).rejects.toThrowError(new RegExp(`already being watched by process ${process.pid}`));
    } finally {
      await first.close();
    }
  });

  it("replaces a stale lock before watching", async () => {
    const { workspace, lines } = await preparedWorkspace();
    const lockPath = join(workspace.paths.amanosDir, WATCH_LOCK_FILE_NAME);
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: 424242, startedAt: "2020-01-01T00:00:00.000Z", root: workspace.paths.root, token: "old" })}\n`,
    );

    const watcher = await startWorkspaceWatcher(workspace, {
      scan: async () => undefined,
      isProcessAlive: () => false,
    });
    try {
      const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
      expect(owner.pid).toBe(process.pid);
      expect(lines).toContain("Removed stale watcher lock from process 424242.");
    } finally {
      await watcher.close();
    }
  });

  it("releases the lock when its abort signal is triggered", async () => {
    const { workspace, lines } = await preparedWorkspace();
    const controller = new AbortController();
    const watcher = await startWorkspaceWatcher(workspace, {
      signal: controller.signal,
      scan: async () => undefined,
    });

    expect(await doesNotExist(watcher.lockPath)).toBe(false);
    controller.abort();
    await watcher.done;

    expect(await doesNotExist(watcher.lockPath)).toBe(true);
    expect(lines.at(-1)).toBe("Watcher stopped.");
  });

  it("keeps the lock when a change reaches quiet expiry during an in-flight scan", async () => {
    const { workspace } = await preparedWorkspace();
    let finishScan: (() => void) | undefined;
    let scans = 0;
    const events: WatchEvent[] = [];
    const watcher = await startWorkspaceWatcher(workspace, {
      quietPeriodMilliseconds: 20,
      scan: async () => {
        scans += 1;
        await new Promise<void>((resolve) => {
          finishScan = resolve;
        });
      },
      onEvent: (event) => events.push(event),
    });
    const note = join(workspace.paths.root, "meeting.txt");
    await writeFile(note, "We decided to wait.\n");
    await waitUntil(() => scans === 1);

    const changesBefore = events.filter(({ type }) => type === "change").length;
    await writeFile(note, "We decided to keep waiting.\n");
    await waitUntil(
      () => events.filter(({ type }) => type === "change").length > changesBefore,
    );
    // Let the second change's quiet timer expire while scan one is still active.
    await new Promise((resolve) => setTimeout(resolve, 40));

    const closing = watcher.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await doesNotExist(watcher.lockPath)).toBe(false);

    finishScan?.();
    await closing;
    expect(await doesNotExist(watcher.lockPath)).toBe(true);
  });
});
