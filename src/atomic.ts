import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { AmanosError } from "./errors.js";

/**
 * Writes a file by filling a temp file next to the target and renaming it into
 * place. A failure anywhere in between leaves the target exactly as it was.
 */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);

  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new AmanosError(`Could not write ${path}: ${describe(error)}`);
  }
}

/** Serialises first, so an unserialisable value never touches the file system. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  let serialised: string;
  try {
    serialised = `${JSON.stringify(value, null, 2)}\n`;
  } catch (error) {
    throw new AmanosError(`Could not serialise the contents of ${path}: ${describe(error)}`);
  }

  await writeFileAtomic(path, serialised);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
