import { readDecisionFile, type DecisionFile } from "../store/decisions.js";
import {
  readState,
  type RecordedError,
  type Workspace,
  type WorkspaceState,
} from "../workspace/index.js";

/** The persisted facts displayed by `amanos status`. */
export interface StatusSummary {
  readonly activeDecisions: number;
  readonly draftDecisions: number;
  readonly candidateImpacts: number;
  readonly blockedChanges: number;
  readonly lastScanAt: string | null;
  readonly errors: number;
  readonly errorDetails: readonly RecordedError[];
}

export interface StatusOptions {
  /** Injectable clock so relative output remains deterministic in tests. */
  readonly now?: () => number;
  /** Include the path, cause and timestamp of every recorded scan error. */
  readonly verbose?: boolean;
}

/**
 * Derives the compact status without performing I/O. Unknown handwritten
 * statuses remain visible in DECISIONS.md, but are not silently classified as
 * one of the supported states.
 */
export function deriveStatus(
  decisions: DecisionFile,
  state: WorkspaceState,
): StatusSummary {
  return {
    activeDecisions: countStatus(decisions, "active"),
    draftDecisions: countStatus(decisions, "draft"),
    candidateImpacts: countCandidateImpacts(decisions),
    blockedChanges: countStatus(decisions, "blocked"),
    lastScanAt: state.lastScanAt,
    errors: state.errors.length,
    errorDetails: state.errors,
  };
}

/** Formats one summary as the stable, line-oriented CLI representation. */
export function formatStatus(
  summary: StatusSummary,
  now = Date.now(),
  verbose = false,
): readonly string[] {
  return [
    quantity(summary.activeDecisions, "active decision"),
    ...(summary.draftDecisions === 0
      ? []
      : [quantity(summary.draftDecisions, "draft decision")]),
    quantity(summary.candidateImpacts, "candidate impact"),
    quantity(summary.blockedChanges, "blocked change"),
    `Last scan: ${relativeTime(summary.lastScanAt, now)}`,
    ...(summary.errors === 0
      ? []
      : [
          verbose
            ? quantity(summary.errors, "error")
            : `${quantity(summary.errors, "error")} — use --verbose for details`,
          ...(verbose ? summary.errorDetails.map(formatRecordedError) : []),
        ]),
  ];
}

/**
 * Describes a past timestamp at a useful human scale. A small future clock
 * skew is treated as "just now" rather than producing a misleading duration.
 */
export function relativeTime(timestamp: string | null, now = Date.now()): string {
  if (timestamp === null) return "never";

  const scannedAt = Date.parse(timestamp);
  if (!Number.isFinite(scannedAt)) return "unknown";

  const elapsedSeconds = Math.max(0, Math.floor((now - scannedAt) / 1_000));
  if (elapsedSeconds < 60) return "just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${quantity(elapsedMinutes, "minute")} ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${quantity(elapsedHours, "hour")} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${quantity(elapsedDays, "day")} ago`;
}

/** Reads, derives and prints status. Missing files surface as an AmanosError. */
export async function readStatus(
  workspace: Workspace,
  options: StatusOptions = {},
): Promise<StatusSummary> {
  const [decisions, state] = await Promise.all([
    readDecisionFile(workspace.paths),
    readState(workspace.paths),
  ]);
  const summary = deriveStatus(decisions, state);

  for (const line of formatStatus(
    summary,
    (options.now ?? Date.now)(),
    options.verbose === true,
  )) {
    workspace.io.out(line);
  }

  return summary;
}

const CANDIDATE_LINE = /^- \[[ xX]\] candidate · ([^\r\n]+?)[ \t]*\r?$/gm;

function countStatus(decisions: DecisionFile, status: string): number {
  return decisions.decisions.filter((decision) => decision.status === status).length;
}

function countCandidateImpacts(decisions: DecisionFile): number {
  const candidates = new Set<string>();

  for (const decision of decisions.decisions) {
    const block = decisions.content.slice(decision.start, decision.end);
    for (const match of block.matchAll(CANDIDATE_LINE)) {
      candidates.add(`${decision.id}\u0000${(match[1] as string).trim()}`);
    }
  }

  return candidates.size;
}

function quantity(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatRecordedError(error: RecordedError): string {
  const path = error.path ?? ".";
  const timestamp = error.at ?? "unknown time";
  return `  error ${path} at ${timestamp}: ${oneLine(error.message)}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
