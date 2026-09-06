import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A temporary directory whose name contains a space, because Windows paths do. */
export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "amanos test "));
  created.push(dir);
  return dir;
}
