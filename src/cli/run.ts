import { resolve } from "node:path";

import { UsageError } from "../errors.js";
import type { Io } from "../io.js";
import { scanImpacts } from "../impact/index.js";
import { initWorkspace, readStatus } from "../store/index.js";
import { watchWorkspace } from "../watcher/index.js";
import { parseArgs } from "./args.js";
import { helpText } from "./help.js";
import { version } from "./version.js";

/** Runs one CLI invocation and returns the process exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const invocation = parseArgs(argv);

  switch (invocation.kind) {
    case "help":
      io.out(helpText());
      return 0;
    case "version":
      io.out(version());
      return 0;
    case "command":
      await dispatch(invocation.command, resolve(invocation.workspace), io);
      return 0;
  }
}

async function dispatch(command: string, workspace: string, io: Io): Promise<void> {
  switch (command) {
    case "init":
      await initWorkspace(workspace, io);
      return;
    case "scan":
      await scanImpacts(workspace, io);
      return;
    case "watch":
      await watchWorkspace(workspace, io);
      return;
    case "status":
      await readStatus(workspace, io);
      return;
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}
