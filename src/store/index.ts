import { NotImplementedError } from "../errors.js";
import type { Workspace } from "../workspace/index.js";

/** Creates DECISIONS.md and .amanos/ in the workspace. */
export async function initWorkspace(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("init");
}

/** Prints a compact overview of decisions, impacts and the last scan. */
export async function readStatus(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("status");
}
