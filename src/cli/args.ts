import { UsageError } from "../errors.js";
import { COMMAND_NAMES } from "./help.js";

export type Invocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "command"; readonly command: string; readonly workspace: string };

/**
 * Parses `amanos <command> <workspace>` plus the global --help/--version flags.
 * Everything unexpected becomes a UsageError with a message the user can act on.
 */
export function parseArgs(argv: readonly string[]): Invocation {
  const args = [...argv];

  if (args.length === 0) {
    return { kind: "help" };
  }

  if (args.some((arg) => arg === "-h" || arg === "--help")) {
    return { kind: "help" };
  }

  if (args.some((arg) => arg === "-v" || arg === "--version")) {
    return { kind: "version" };
  }

  const [command, ...rest] = args;
  if (command === undefined || command.startsWith("-")) {
    throw new UsageError(`Unknown option "${command ?? ""}".`);
  }

  if (!COMMAND_NAMES.includes(command)) {
    throw new UsageError(
      `Unknown command "${command}". Expected one of: ${COMMAND_NAMES.join(", ")}.`,
    );
  }

  const workspace = rest[0];
  if (workspace === undefined) {
    throw new UsageError(`Missing <workspace> argument for "${command}".`);
  }

  if (rest.length > 1) {
    throw new UsageError(
      `Too many arguments for "${command}". Expected a single <workspace> path.`,
    );
  }

  return { kind: "command", command, workspace };
}
