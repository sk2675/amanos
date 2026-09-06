export interface CommandSpec {
  readonly name: string;
  readonly args: string;
  readonly description: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "init",
    args: "<workspace>",
    description: "Create DECISIONS.md and .amanos/ in the workspace.",
  },
  {
    name: "scan",
    args: "<workspace> [--dry-run]",
    description: "Find decisions and candidate impacts across all repositories.",
  },
  {
    name: "watch",
    args: "<workspace>",
    description: "Watch the workspace for changes and scan after a quiet period.",
  },
  {
    name: "status",
    args: "<workspace>",
    description: "Show a compact overview of decisions, impacts and the last scan.",
  },
];

export const COMMAND_NAMES: readonly string[] = COMMANDS.map((command) => command.name);

export function helpText(): string {
  const column = Math.max(...COMMANDS.map((c) => `${c.name} ${c.args}`.length));
  const lines = COMMANDS.map((c) => {
    const usage = `${c.name} ${c.args}`.padEnd(column);
    return `  ${usage}  ${c.description}`;
  });

  return [
    "amanos — a local-first decision memory for projects and code.",
    "",
    "Usage:",
    "  amanos <command> <workspace>",
    "",
    "Commands:",
    ...lines,
    "",
    "Options:",
    "  --dry-run      Preview scan changes without writing any files.",
    "  -h, --help     Show this help.",
    "  -v, --version  Show the installed version.",
    "",
  ].join("\n");
}
