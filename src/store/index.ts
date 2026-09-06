import { NotImplementedError } from "../errors.js";
import type { Workspace } from "../workspace/index.js";

/** Prints a compact overview of decisions, impacts and the last scan. */
export async function readStatus(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("status");
}

export { DECISIONS_HEADER } from "./decisions.js";
export { initWorkspace, type InitOutcome, type InitResult } from "./init.js";
