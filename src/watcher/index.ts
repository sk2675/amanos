import { NotImplementedError } from "../errors.js";
import type { Workspace } from "../workspace/index.js";

/** Watches the workspace and scans once the quiet period has passed. */
export async function watchWorkspace(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("watch");
}
