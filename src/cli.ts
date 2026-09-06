#!/usr/bin/env node
import { run } from "./cli/run.js";
import { AmanosError, UsageError } from "./errors.js";
import { consoleIo } from "./io.js";

try {
  process.exitCode = await run(process.argv.slice(2), consoleIo);
} catch (error) {
  if (error instanceof AmanosError) {
    consoleIo.err(`amanos: ${error.message}`);
    if (error instanceof UsageError) {
      consoleIo.err(`Run "amanos --help" to see the available commands.`);
    }
    process.exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    consoleIo.err(`amanos: unexpected error: ${message}`);
    process.exitCode = 1;
  }
}
