import { mkdir, stat } from "node:fs/promises";
import { relative, sep } from "node:path";

import { writeFileAtomic, writeJsonAtomic } from "../atomic.js";
import { AmanosError } from "../errors.js";
import { DEFAULT_CONFIG, INITIAL_STATE, type Workspace } from "../workspace/index.js";
import type { WorkspacePaths } from "../workspace/paths.js";
import { DECISIONS_HEADER } from "./decisions.js";

/** What happened to a single artefact during init. */
export type InitOutcome = "created" | "exists";

export interface InitResult {
  readonly path: string;
  readonly outcome: InitOutcome;
}

/**
 * Creates the three V1 artefacts and nothing else. Files that are already
 * there stay byte-identical, so running init twice is safe.
 */
export async function initWorkspace(workspace: Workspace): Promise<readonly InitResult[]> {
  const { paths, io } = workspace;

  await makeAmanosDir(paths);

  const results: readonly InitResult[] = [
    await createIfMissing(paths.decisions, () => writeFileAtomic(paths.decisions, DECISIONS_HEADER)),
    await createIfMissing(paths.config, () => writeJsonAtomic(paths.config, DEFAULT_CONFIG)),
    await createIfMissing(paths.state, () => writeJsonAtomic(paths.state, INITIAL_STATE)),
  ];

  for (const result of results) {
    io.out(`  ${result.outcome.padEnd(7)} ${display(paths.root, result.path)}`);
  }

  const created = results.filter((result) => result.outcome === "created").length;
  io.out(
    created === results.length
      ? `Initialised the amanos workspace in ${paths.root}.`
      : `Workspace ${paths.root} is up to date (${created} created, ${results.length - created} kept).`,
  );

  return results;
}

async function makeAmanosDir(paths: WorkspacePaths): Promise<void> {
  try {
    await mkdir(paths.amanosDir, { recursive: true });
  } catch (error) {
    throw new AmanosError(`Could not create ${paths.amanosDir}: ${describe(error)}`);
  }
}

/** Existing files are left untouched — init never rewrites what it finds. */
async function createIfMissing(path: string, write: () => Promise<void>): Promise<InitResult> {
  if (await exists(path)) {
    return { path, outcome: "exists" };
  }

  await write();
  return { path, outcome: "created" };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new AmanosError(`Could not inspect ${path}: ${describe(error)}`);
  }
}

/** Paths are shown relative to the workspace, with forward slashes everywhere. */
function display(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
