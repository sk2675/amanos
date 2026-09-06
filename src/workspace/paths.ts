import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AmanosError } from "../errors.js";

/** Every file amanos owns inside a workspace, resolved to absolute paths. */
export interface WorkspacePaths {
  /** The workspace directory itself. */
  readonly root: string;
  /** `<workspace>/DECISIONS.md` — the readable truth. */
  readonly decisions: string;
  /** `<workspace>/.amanos` — the local index. */
  readonly amanosDir: string;
  /** `<workspace>/.amanos/config.json` */
  readonly config: string;
  /** `<workspace>/.amanos/state.json` */
  readonly state: string;
}

export const AMANOS_DIR_NAME = ".amanos";
export const DECISIONS_FILE_NAME = "DECISIONS.md";
export const CONFIG_FILE_NAME = "config.json";
export const STATE_FILE_NAME = "state.json";

/** Derives all workspace paths from a root that has already been validated. */
export function workspacePaths(root: string): WorkspacePaths {
  const absoluteRoot = resolve(root);
  const amanosDir = join(absoluteRoot, AMANOS_DIR_NAME);

  return {
    root: absoluteRoot,
    decisions: join(absoluteRoot, DECISIONS_FILE_NAME),
    amanosDir,
    config: join(amanosDir, CONFIG_FILE_NAME),
    state: join(amanosDir, STATE_FILE_NAME),
  };
}

/**
 * Resolves the workspace argument and checks that it points at an existing
 * directory. Paths with spaces are handled like any other path.
 */
export async function resolveWorkspace(workspace: string): Promise<WorkspacePaths> {
  const root = resolve(workspace);

  let entry;
  try {
    entry = await stat(root);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new AmanosError(`Workspace "${root}" does not exist.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AmanosError(`Workspace "${root}" is not readable: ${reason}`);
  }

  if (!entry.isDirectory()) {
    throw new AmanosError(`Workspace "${root}" is not a directory.`);
  }

  return workspacePaths(root);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
