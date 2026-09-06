/** Terminal output, injected so commands stay testable. */
export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export const consoleIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};
