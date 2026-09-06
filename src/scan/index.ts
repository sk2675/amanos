import {
  createAgentAdapter,
  type AgentAdapter,
  type AgentAdapterFactory,
  type AgentResult,
  type AgentSource,
} from "../agent/index.js";
import { scanImpacts, type ImpactScanError, type ImpactScanResult } from "../impact/index.js";
import { parseDecisions } from "../parser/index.js";
import { appendDecisions, type AppendedDecision } from "../store/index.js";
import { readConfig, type Workspace } from "../workspace/index.js";
import { readSourceFiles } from "./sources.js";

export interface ScanOptions {
  readonly dryRun?: boolean;
  /** Print each recoverable error after the compact summary. */
  readonly verbose?: boolean;
  /** Injectable values keep integration tests deterministic. */
  readonly scannedAt?: string;
  readonly now?: () => number;
  /** The production factory always returns V1's no-op adapter. */
  readonly agentFactory?: AgentAdapterFactory;
}

export interface AgentRun {
  readonly decisionId: string;
  readonly repositoryPath: string;
  readonly result: AgentResult;
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
  readonly agentRuns: readonly AgentRun[];
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
  const agent = (options.agentFactory ?? createAgentAdapter)(config.agent);
  const sources = await readSourceFiles(workspace.paths);
  const findings = sources.files.flatMap((source) =>
    parseDecisions(source.path, source.content, { config, detectedAt: scannedAt }),
  );
  // This is the durability boundary: persist recognized decisions before any
  // repository or agent work that can fail independently.
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
  // A dry run must not cross even an injected agent seam. The production V1
  // adapter is a no-op regardless, but this keeps the preview contract strict.
  const agentRuns = dryRun
    ? []
    : await prepareWithAgent(agent, appended.appended, sources.files, impacts);
  const durationMs = Math.max(0, Math.round(now() - startedAt));

  const result: ScanResult = {
    dryRun,
    filesRead: sources.files.length,
    findings: findings.length,
    newDecisions: appended.appended.length,
    newCandidates: impacts.added,
    durationMs,
    appended: appended.appended,
    impacts,
    agentRuns,
    errors: impacts.errors,
  };

  report(workspace, result, options.verbose === true);
  return result;
}

/** Runs sequentially so two decisions can never race while preparing one repo. */
async function prepareWithAgent(
  agent: AgentAdapter,
  appended: readonly AppendedDecision[],
  sources: readonly AgentSource[],
  impacts: ImpactScanResult,
): Promise<readonly AgentRun[]> {
  const runs: AgentRun[] = [];

  for (const item of appended) {
    const decisionSources = sources.filter(({ path }) => path === item.decision.sourcePath);
    for (const target of impacts.targets.filter(({ decisionId }) => decisionId === item.id)) {
      const result = await agent.prepare({
        decisionId: item.id,
        decision: item.decision,
        sources: decisionSources,
        repositoryPath: target.repositoryPath,
        candidatePaths: target.candidatePaths,
      });
      runs.push({ decisionId: item.id, repositoryPath: target.repositoryPath, result });
    }
  }

  return runs;
}

function report(workspace: Workspace, result: ScanResult, verbose: boolean): void {
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

  if (result.errors.length > 0) {
    workspace.io.err(
      verbose
        ? `${quantity(result.errors.length, "error")}.`
        : `${quantity(result.errors.length, "error")} — use --verbose for details.`,
    );
  }
  if (verbose) {
    for (const error of result.errors) {
      workspace.io.err(`  error ${error.path}: ${oneLine(error.message)}`);
    }
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

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export { readSourceFiles, type SourceFile, type SourceReadError, type SourceReadResult } from "./sources.js";
