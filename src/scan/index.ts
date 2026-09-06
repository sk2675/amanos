import { scanImpacts, type ImpactScanError, type ImpactScanResult } from "../impact/index.js";
import { parseDecisions } from "../parser/index.js";
import { appendDecisions, type AppendedDecision } from "../store/index.js";
import { readConfig, type Workspace } from "../workspace/index.js";
import { readSourceFiles } from "./sources.js";

export interface ScanOptions {
  readonly dryRun?: boolean;
  /** Injectable values keep integration tests deterministic. */
  readonly scannedAt?: string;
  readonly now?: () => number;
}

export interface ScanResult {
  readonly dryRun: boolean;
  readonly filesRead: number;
  readonly findings: number;
  readonly newDecisions: number;
  readonly newCandidates: number;
  readonly durationMs: number;
  readonly appended: readonly AppendedDecision[];
  readonly impacts: ImpactScanResult;
  readonly errors: readonly ImpactScanError[];
}

/** Runs the complete one-shot scan from source notes through persisted impacts. */
export async function scanWorkspace(
  workspace: Workspace,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const scannedAt = options.scannedAt ?? new Date().toISOString();
  const dryRun = options.dryRun === true;
  const config = await readConfig(workspace.paths);
  const sources = await readSourceFiles(workspace.paths);
  const findings = sources.files.flatMap((source) =>
    parseDecisions(source.path, source.content, { config, detectedAt: scannedAt }),
  );
  const appended = await appendDecisions(workspace.paths, findings, { dryRun });
  const impacts = await scanImpacts(workspace, scannedAt, {
    dryRun,
    quiet: true,
    initialErrors: sources.errors,
    ...(dryRun
      ? {
          additionalDecisions: appended.appended.map(({ id, decision }) => ({
            id,
            title: decision.statement,
            source: decision.location,
          })),
        }
      : {}),
  });
  const durationMs = Math.max(0, Math.round(now() - startedAt));

  report(workspace, {
    dryRun,
    filesRead: sources.files.length,
    findings: findings.length,
    newDecisions: appended.appended.length,
    newCandidates: impacts.added,
    durationMs,
    appended: appended.appended,
    impacts,
    errors: impacts.errors,
  });

  return {
    dryRun,
    filesRead: sources.files.length,
    findings: findings.length,
    newDecisions: appended.appended.length,
    newCandidates: impacts.added,
    durationMs,
    appended: appended.appended,
    impacts,
    errors: impacts.errors,
  };
}

function report(workspace: Workspace, result: ScanResult): void {
  const prefix = result.dryRun ? "Dry run: " : "";
  workspace.io.out(`${prefix}Read ${quantity(result.filesRead, "source file")}.`);
  workspace.io.out(`${prefix}${decisionSummary(result.newDecisions)}`);
  workspace.io.out(`${prefix}${candidateSummary(result.newCandidates)}`);

  if (result.dryRun) {
    for (const { id, decision } of result.appended) {
      workspace.io.out(`  would add ${id} from ${decision.location}`);
    }
    for (const candidate of result.impacts.addedCandidates) {
      workspace.io.out(`  would add candidate ${candidate.decisionId} · ${candidate.path}`);
    }
  }

  for (const error of result.errors) {
    workspace.io.err(`  error ${error.path}: ${error.message}`);
  }
  workspace.io.out(`${prefix}Completed in ${result.durationMs} ms.`);
}

function decisionSummary(count: number): string {
  return count === 0 ? "No new decisions." : `Found ${quantity(count, "new decision")}.`;
}

function candidateSummary(count: number): string {
  return count === 0 ? "No new candidate impacts." : `Found ${quantity(count, "new candidate impact")}.`;
}

function quantity(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export { readSourceFiles, type SourceFile, type SourceReadError, type SourceReadResult } from "./sources.js";
