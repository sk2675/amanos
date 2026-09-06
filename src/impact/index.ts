import { NotImplementedError } from "../errors.js";
import type { Io } from "../io.js";

/** Finds decisions and candidate impacts across every repository in the workspace. */
export async function scanImpacts(_workspace: string, _io: Io): Promise<void> {
  throw new NotImplementedError("scan");
}
