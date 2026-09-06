import { NotImplementedError } from "../errors.js";
import type { Io } from "../io.js";

/** Creates DECISIONS.md and .amanos/ in the workspace. */
export async function initWorkspace(_workspace: string, _io: Io): Promise<void> {
  throw new NotImplementedError("init");
}

/** Prints a compact overview of decisions, impacts and the last scan. */
export async function readStatus(_workspace: string, _io: Io): Promise<void> {
  throw new NotImplementedError("status");
}
