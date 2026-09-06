import { UsageError } from "../errors.js";
import type { Io } from "../io.js";
import { scanWorkspace } from "../scan/index.js";
import { initWorkspace, readStatus } from "../store/index.js";
import { watchWorkspace } from "../watcher/index.js";
import { openWorkspace, type Workspace } from "../workspace/index.js";
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
      await dispatch(
        invocation.command,
        await openWorkspace(invocation.workspace, io),
        invocation.dryRun === true,
      );
      return 0;
  }
}

async function dispatch(command: string, workspace: Workspace, dryRun: boolean): Promise<void> {
  switch (command) {
    case "init":
      await initWorkspace(workspace);
      return;
    case "scan":
      await scanWorkspace(workspace, { dryRun });
      return;
    case "watch":
      await watchWorkspace(workspace);
      return;
    case "status":
      await readStatus(workspace);
      return;
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}
