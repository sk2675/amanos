/** Errors that are expected during normal operation and printed without a stacktrace. */
export class AmanosError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "AmanosError";
    this.exitCode = exitCode;
  }
}

/** The user invoked the CLI wrongly — the help hint is shown alongside the message. */
export class UsageError extends AmanosError {
  constructor(message: string) {
    super(message, 2);
    this.name = "UsageError";
  }
}

/** A module boundary exists, the behaviour behind it does not yet. */
export class NotImplementedError extends AmanosError {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
