import { NotImplementedError } from "../errors.js";
import type { DecisionStatus } from "../workspace/config.js";

/** A decision found in free text, with enough provenance to show it in DECISIONS.md. */
export interface Decision {
  readonly statement: string;
  readonly sourcePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly detectedAt: string;
  readonly confidence: number;
  readonly status: DecisionStatus;
}

/** Detects decisions in a single text file's content. */
export function parseDecisions(_path: string, _content: string): readonly Decision[] {
  throw new NotImplementedError("the decision parser");
}
