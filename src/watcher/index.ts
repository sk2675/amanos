import { NotImplementedError } from "../errors.js";
import type { Io } from "../io.js";

/** Watches the workspace and scans once the quiet period has passed. */
export async function watchWorkspace(_workspace: string, _io: Io): Promise<void> {
  throw new NotImplementedError("watch");
}
