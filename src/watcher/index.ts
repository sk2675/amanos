import { watch, type FSWatcher } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { AmanosError } from "../errors.js";
import { isSupportedSource } from "../parser/index.js";
import { IGNORED_DIRECTORY_NAMES } from "../repos/index.js";
import { scanWorkspace, type ScanResult } from "../scan/index.js";
import { readConfig, type Workspace } from "../workspace/index.js";

export const WATCH_LOCK_FILE_NAME = "watch.lock";

const EXTRA_IGNORED_DIRECTORY_NAMES = [
  ".git",
  ".astro",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".vite",
  "__pycache__",
  "out",
  "target",
] as const;

const IGNORED_DIRECTORIES = new Set([
  ...IGNORED_DIRECTORY_NAMES,
  ...EXTRA_IGNORED_DIRECTORY_NAMES,
]);

export type WatchScan = (workspace: Workspace) => Promise<ScanResult | void>;

export type WatchEvent =
  | { readonly type: "ready"; readonly quietPeriodMs: number }
  | { readonly type: "stale-lock-removed"; readonly pid?: number }
  | { readonly type: "change"; readonly path: string; readonly quietPeriodMs: number }
  | { readonly type: "scan-started" }
  | { readonly type: "scan-finished"; readonly result?: ScanResult }
  | { readonly type: "scan-failed"; readonly error: unknown }
  | { readonly type: "watch-failed"; readonly error: unknown }
  | { readonly type: "stopped" };

export interface WatchOptions {
  /** Overrides the production scan; useful for embedding and deterministic tests. */
  readonly scan?: WatchScan;
  /** Stops the watcher and releases its lock when aborted. */
  readonly signal?: AbortSignal;
  /** Test-only precision override. Production uses `quietPeriodSeconds` from config. */
  readonly quietPeriodMilliseconds?: number;
  /** Receives lifecycle events in addition to the concise terminal messages. */
  readonly onEvent?: (event: WatchEvent) => void;
  /** Injectable process probe for stale-lock tests. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface WorkspaceWatcher {
  readonly lockPath: string;
  /** Resolves after every resource, including the workspace lock, has been released. */
  readonly done: Promise<void>;
  close(): Promise<void>;
}

interface LockOwner {
  readonly pid: number;
  readonly startedAt: string;
  readonly root: string;
  readonly token: string;
}

interface AcquiredLock {
  readonly path: string;
  readonly owner: LockOwner;
}

/**
 * Runs a watcher until Ctrl+C (or an injected abort signal) and then cleans up.
 * Keeping signal ownership here makes the CLI path small while `startWorkspaceWatcher`
 * remains directly controllable from tests and other callers.
 */
export async function watchWorkspace(
  workspace: Workspace,
  options: WatchOptions = {},
): Promise<void> {
  if (options.signal !== undefined) {
    const watcher = await startWorkspaceWatcher(workspace, options);
    await watcher.done;
    return;
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const watcher = await startWorkspaceWatcher(workspace, {
      ...options,
      signal: controller.signal,
    });
    await watcher.done;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

/** Starts watching immediately and returns a handle that can be closed idempotently. */
export async function startWorkspaceWatcher(
  workspace: Workspace,
  options: WatchOptions = {},
): Promise<WorkspaceWatcher> {
  const config = await readConfig(workspace.paths);
  const quietPeriodMs =
    options.quietPeriodMilliseconds ?? config.quietPeriodSeconds * 1_000;
  if (!Number.isFinite(quietPeriodMs) || quietPeriodMs < 0) {
    throw new AmanosError("Watcher quiet period must be a non-negative number of milliseconds.");
  }

  const emit = createReporter(workspace, options.onEvent);
  const lock = await acquireLock(workspace, options.isProcessAlive ?? processIsAlive, emit);
  let fileWatcher: FSWatcher;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirtySince: number | undefined;
  let scanning = false;
  let activeScan: Promise<void> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let terminalError: AmanosError | undefined;
  let resolveDone: (() => void) | undefined;
  let rejectDone: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolveDonePromise, rejectDonePromise) => {
    resolveDone = resolveDonePromise;
    rejectDone = rejectDonePromise;
  });

  const clearQuietTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (): void => {
    clearQuietTimer();
    if (closed || dirtySince === undefined) return;
    const elapsed = Date.now() - dirtySince;
    timer = setTimeout(() => {
      timer = undefined;
      // The active scan's `finally` will re-arm this pending change. Starting a
      // no-op promise here would hide the real scan from `close()`.
      if (scanning) return;
      const startedScan = runScan();
      activeScan = startedScan;
      void startedScan.finally(() => {
        if (activeScan === startedScan) activeScan = undefined;
      });
    }, Math.max(0, quietPeriodMs - elapsed));
  };

  const runScan = async (): Promise<void> => {
    if (closed || scanning || dirtySince === undefined) return;

    scanning = true;
    dirtySince = undefined;
    emit({ type: "scan-started" });
    try {
      const result = await (options.scan ?? scanWorkspace)(workspace);
      if (!closed) {
        emit(result === undefined ? { type: "scan-finished" } : { type: "scan-finished", result });
      }
    } catch (error) {
      if (!closed) emit({ type: "scan-failed", error });
    } finally {
      scanning = false;
      // A change during the scan starts one later run, after its own quiet period.
      if (!closed && dirtySince !== undefined) schedule();
    }
  };

  const runner = {
    changed(path: string): void {
      if (closed) return;
      dirtySince = Date.now();
      emit({ type: "change", path, quietPeriodMs });
      schedule();
    },
  };

  try {
    fileWatcher = watch(
      workspace.paths.root,
      { recursive: true, persistent: true },
      (_eventType, filename) => {
        const changedPath = relevantPath(workspace, filename);
        if (changedPath !== undefined) runner.changed(changedPath);
      },
    );
  } catch (error) {
    await releaseLock(lock);
    throw new AmanosError(`Could not watch ${workspace.paths.root}: ${describe(error)}`);
  }

  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    clearQuietTimer();
    fileWatcher.close();
    if (options.signal !== undefined) options.signal.removeEventListener("abort", onAbort);

    // Keep the workspace lock until an in-flight scan has settled. This closes
    // the only window in which another process could otherwise start in parallel.
    closePromise = (activeScan ?? Promise.resolve()).then(() => releaseLock(lock)).then(
      () => {
        emit({ type: "stopped" });
        if (terminalError === undefined) resolveDone?.();
        else rejectDone?.(terminalError);
      },
      (error: unknown) => {
        rejectDone?.(error);
        throw error;
      },
    );
    return closePromise;
  };

  const onAbort = (): void => {
    void close().catch(() => undefined);
  };

  fileWatcher.on("error", (error) => {
    if (closed) return;
    emit({ type: "watch-failed", error });
    terminalError = new AmanosError(`Workspace watcher failed: ${describe(error)}`);
    void close().catch(() => undefined);
  });

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      await close();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (!closed) emit({ type: "ready", quietPeriodMs });

  return { lockPath: lock.path, done, close };
}

/** Filters recursive filesystem events down to user-authored source files. */
export function isRelevantWatchPath(workspace: Workspace, path: string): boolean {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(workspace.paths.root, path);
  const workspaceRelative = relative(workspace.paths.root, absolutePath);
  if (
    workspaceRelative === "" ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith(`..${sep}`) ||
    isAbsolute(workspaceRelative)
  ) {
    return false;
  }
  if (absolutePath === workspace.paths.decisions) return false;

  const segments = workspaceRelative.split(/[\\/]/u);
  return !segments.some((segment) => IGNORED_DIRECTORIES.has(segment)) && isSupportedSource(path);
}

function relevantPath(
  workspace: Workspace,
  filename: string | Buffer | null,
): string | undefined {
  // Some watch backends omit the filename. Scanning is safer than losing a change.
  if (filename === null) return "(unknown file)";
  const path = filename.toString();
  if (!isRelevantWatchPath(workspace, path)) return undefined;
  return relative(workspace.paths.root, resolve(workspace.paths.root, path)).split(sep).join("/");
}

async function acquireLock(
  workspace: Workspace,
  isAlive: (pid: number) => boolean,
  emit: (event: WatchEvent) => void,
): Promise<AcquiredLock> {
  const path = resolve(workspace.paths.amanosDir, WATCH_LOCK_FILE_NAME);
  const owner: LockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    root: workspace.paths.root,
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await writeFile(path, `${JSON.stringify(owner, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return { path, owner };
    } catch (error) {
      if (!isCode(error, "EEXIST")) {
        throw new AmanosError(`Could not create watcher lock ${path}: ${describe(error)}`);
      }
    }

    const existing = await readLock(path);
    if (existing !== undefined && isAlive(existing.pid)) {
      throw new AmanosError(
        `Workspace "${workspace.paths.root}" is already being watched by process ${existing.pid}.`,
      );
    }

    const stalePath = `${path}.stale-${owner.token}-${attempt}`;
    try {
      await rename(path, stalePath);
      await unlink(stalePath);
      emit({
        type: "stale-lock-removed",
        ...(existing === undefined ? {} : { pid: existing.pid }),
      });
    } catch (error) {
      if (!isCode(error, "ENOENT")) {
        throw new AmanosError(`Could not remove stale watcher lock ${path}: ${describe(error)}`);
      }
    }
  }

  throw new AmanosError(`Could not acquire watcher lock ${path} after several attempts.`);
}

async function readLock(path: string): Promise<LockOwner | undefined> {
  try {
    const candidate: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "pid" in candidate &&
      typeof candidate.pid === "number" &&
      Number.isSafeInteger(candidate.pid) &&
      candidate.pid > 0
    ) {
      return candidate as LockOwner;
    }
    return undefined;
  } catch (error) {
    if (isCode(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw new AmanosError(`Could not read watcher lock ${path}: ${describe(error)}`);
  }
}

async function releaseLock(lock: AcquiredLock): Promise<void> {
  let existing: LockOwner | undefined;
  try {
    existing = await readLock(lock.path);
  } catch (error) {
    throw new AmanosError(`Could not release watcher lock ${lock.path}: ${describe(error)}`);
  }

  // Never delete a lock that another watcher somehow acquired in the meantime.
  if (existing?.token !== lock.owner.token) return;
  try {
    await unlink(lock.path);
  } catch (error) {
    if (!isCode(error, "ENOENT")) {
      throw new AmanosError(`Could not release watcher lock ${lock.path}: ${describe(error)}`);
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission errors still prove that a process with this PID exists.
    return isCode(error, "EPERM");
  }
}

function createReporter(
  workspace: Workspace,
  listener: ((event: WatchEvent) => void) | undefined,
): (event: WatchEvent) => void {
  return (event) => {
    listener?.(event);
    switch (event.type) {
      case "ready":
        workspace.io.out(
          `Watching ${workspace.paths.root}. Quiet period: ${duration(event.quietPeriodMs)}.`,
        );
        return;
      case "stale-lock-removed":
        workspace.io.out(
          event.pid === undefined
            ? "Removed stale watcher lock."
            : `Removed stale watcher lock from process ${event.pid}.`,
        );
        return;
      case "change":
        workspace.io.out(
          `Change detected: ${event.path}. Waiting ${duration(event.quietPeriodMs)}.`,
        );
        return;
      case "scan-started":
        workspace.io.out("Scan started.");
        return;
      case "scan-finished":
        workspace.io.out(scanSummary(event.result));
        return;
      case "scan-failed":
        workspace.io.err(`Scan failed: ${describe(event.error)}`);
        return;
      case "watch-failed":
        workspace.io.err(`Watcher failed: ${describe(event.error)}`);
        return;
      case "stopped":
        workspace.io.out("Watcher stopped.");
        return;
    }
  };
}

function scanSummary(result: ScanResult | undefined): string {
  if (result === undefined) return "Scan finished.";
  return `Scan finished: ${result.newDecisions} new decision${result.newDecisions === 1 ? "" : "s"}, ${result.newCandidates} new candidate impact${result.newCandidates === 1 ? "" : "s"}, ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`;
}

function duration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
