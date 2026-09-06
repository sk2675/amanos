import { NotImplementedError } from "../errors.js";
import type { Workspace } from "../workspace/index.js";

/** Finds decisions and candidate impacts across every repository in the workspace. */
export async function scanImpacts(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("scan");
}
