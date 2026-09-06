import { NotImplementedError } from "../errors.js";
import type { Workspace } from "../workspace/index.js";

/** Prints a compact overview of decisions, impacts and the last scan. */
export async function readStatus(_workspace: Workspace): Promise<void> {
  throw new NotImplementedError("status");
}

export {
  DECISIONS_HEADER,
  MAX_IMPACT_CANDIDATES,
  appendDecisions,
  formatDecisionId,
  parseDecisionFile,
  readDecisionFile,
  serialiseDecisionFile,
  updateDecisionImpacts,
  updateDecisionStatus,
  type AppendDecisionsResult,
  type AppendedDecision,
  type DecisionFile,
  type DecisionImpactUpdate,
  type ImpactUpdateResult,
  type StatusUpdateResult,
  type StoredDecision,
} from "./decisions.js";
export { initWorkspace, type InitOutcome, type InitResult } from "./init.js";
