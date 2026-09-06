import { UsageError } from "../errors.js";
import { COMMAND_NAMES } from "./help.js";

export type Invocation =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | {
      readonly kind: "command";
      readonly command: string;
      readonly workspace: string;
      readonly dryRun?: true;
    };

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

  const unknownOption = rest.find((arg) => arg.startsWith("-") && arg !== "--dry-run");
  if (unknownOption !== undefined) {
    throw new UsageError(`Unknown option "${unknownOption}".`);
  }

  const dryRunFlags = rest.filter((arg) => arg === "--dry-run");
  if (dryRunFlags.length > 1) {
    throw new UsageError('Option "--dry-run" may only be specified once.');
  }
  if (dryRunFlags.length === 1 && command !== "scan") {
    throw new UsageError('Option "--dry-run" is only available for "scan".');
  }

  const positional = rest.filter((arg) => arg !== "--dry-run");
  const workspace = positional[0];
  if (workspace === undefined) {
    throw new UsageError(`Missing <workspace> argument for "${command}".`);
  }

  if (positional.length > 1) {
    throw new UsageError(
      `Too many arguments for "${command}". Expected a single <workspace> path.`,
    );
  }

  return {
    kind: "command",
    command,
    workspace,
    ...(dryRunFlags.length === 1 ? { dryRun: true as const } : {}),
  };
}
