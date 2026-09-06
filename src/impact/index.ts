import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

import { deriveKeywords, wordsOf } from "../keywords.js";
import {
  discoverRepositories,
  IGNORED_DIRECTORY_NAMES,
  type Repository,
} from "../repos/index.js";
import {
  MAX_IMPACT_CANDIDATES,
  readDecisionFile,
  updateDecisionImpacts,
} from "../store/index.js";
import { readState, writeState, type Workspace } from "../workspace/index.js";

export interface ImpactCandidate {
  readonly path: string;
  readonly matchedKeywords: readonly string[];
  readonly occurrences: number;
}

export interface DecisionImpact {
  readonly decisionId: string;
  readonly keywords: readonly string[];
  readonly candidates: readonly ImpactCandidate[];
}

export interface ImpactScanError {
  readonly path: string;
  readonly message: string;
}

export interface ImpactScanResult {
  readonly repositories: number;
  readonly decisions: number;
  readonly candidates: number;
  readonly added: number;
  readonly addedCandidates: readonly ImpactCandidateAddition[];
  readonly impacts: readonly DecisionImpact[];
  /** Candidates grouped into repository-local inputs for the agent seam. */
  readonly targets: readonly ImpactTarget[];
  readonly errors: readonly ImpactScanError[];
}

export interface ImpactCandidateAddition {
  readonly decisionId: string;
  readonly path: string;
}

export interface ImpactTarget {
  readonly decisionId: string;
  /** Absolute repository root. */
  readonly repositoryPath: string;
  /** Candidate files relative to `repositoryPath`, ranked most relevant first. */
  readonly candidatePaths: readonly string[];
}

/** A not-yet-persisted decision included when previewing a full scan. */
export interface AdditionalImpactDecision {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

export interface ImpactScanOptions {
  readonly dryRun?: boolean;
  readonly quiet?: boolean;
  readonly additionalDecisions?: readonly AdditionalImpactDecision[];
  readonly initialErrors?: readonly ImpactScanError[];
}

const MAX_TEXT_FILE_BYTES = 1_000_000;
const GIT_OUTPUT_BUFFER_BYTES = 32 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".config",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lock",
  ".lua",
  ".md",
  ".markdown",
  ".mjs",
  ".cjs",
  ".php",
  ".properties",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_FILE_NAMES = new Set([
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
]);

/** Finds and records ranked, explicitly tentative impacts for every decision. */
export async function scanImpacts(
  workspace: Workspace,
  scannedAt = new Date().toISOString(),
  options: ImpactScanOptions = {},
): Promise<ImpactScanResult> {
  const [file, state, discovery] = await Promise.all([
    readDecisionFile(workspace.paths),
    readState(workspace.paths),
    discoverRepositories(workspace.paths.root),
  ]);
  const errors: ImpactScanError[] = [
    ...(options.initialErrors ?? []),
    ...discovery.errors.map((error) => ({ ...error })),
  ];
  const decisions = [...file.decisions, ...(options.additionalDecisions ?? [])];
  const candidates = new Map<string, Map<string, LocatedImpactCandidate>>(
    decisions.map((decision) => [decision.id, new Map()]),
  );
  const keywords = new Map(
    decisions.map((decision) => [decision.id, deriveKeywords(decision.title)]),
  );

  for (const repository of discovery.repositories) {
    let files: readonly string[];
    try {
      files = await gitFiles(repository.path);
    } catch (error) {
      errors.push({ path: repository.relativePath, message: describe(error) });
      continue;
    }

    for (const repoRelativePath of files) {
      if (!isScannablePath(repoRelativePath)) continue;
      const absolutePath = resolve(repository.path, repoRelativePath);
      if (!isInside(repository.path, absolutePath) || absolutePath === workspace.paths.decisions) {
        continue;
      }

      let content: string | undefined;
      try {
        content = await readableText(absolutePath);
      } catch (error) {
        errors.push({ path: displayPath(repository, repoRelativePath), message: describe(error) });
        continue;
      }
      if (content === undefined) continue;

      const workspacePath = workspaceRelativePath(repository, repoRelativePath);
      const display = displayPath(repository, repoRelativePath);
      const counts = wordCounts(`${repoRelativePath}\n${content}`);

      for (const decision of decisions) {
        if (isDecisionSource(decision.source, workspacePath, display)) continue;
        const matched = (keywords.get(decision.id) ?? []).filter((keyword) => counts.has(keyword));
        if (matched.length === 0) continue;
        const occurrenceCount = matched.reduce((sum, keyword) => sum + (counts.get(keyword) ?? 0), 0);
        const impact: LocatedImpactCandidate = {
          path: display,
          matchedKeywords: matched,
          occurrences: occurrenceCount,
          repositoryPath: repository.path,
          repositoryRelativePath: repoRelativePath.replace(/\\/g, "/"),
        };
        const previous = candidates.get(decision.id)?.get(display);
        if (previous === undefined || compareCandidates(impact, previous) < 0) {
          candidates.get(decision.id)?.set(display, impact);
        }
      }
    }
  }

  const rankedCandidates = new Map(
    decisions.map((decision) => [
      decision.id,
      [...(candidates.get(decision.id)?.values() ?? [])]
        .sort(compareCandidates)
        .slice(0, MAX_IMPACT_CANDIDATES),
    ]),
  );
  const impacts: DecisionImpact[] = decisions.map((decision) => ({
    decisionId: decision.id,
    keywords: keywords.get(decision.id) ?? [],
    candidates: (rankedCandidates.get(decision.id) ?? []).map(
      ({ path, matchedKeywords, occurrences }) => ({ path, matchedKeywords, occurrences }),
    ),
  }));
  const targets = decisions.flatMap((decision) =>
    impactTargets(decision.id, rankedCandidates.get(decision.id) ?? []),
  );
  const persistedIds = new Set(file.decisions.map((decision) => decision.id));
  const updated = await updateDecisionImpacts(
    workspace.paths,
    impacts
      .filter((impact) => persistedIds.has(impact.decisionId))
      .map((impact) => ({
        id: impact.decisionId,
        candidatePaths: impact.candidates.map((candidate) => candidate.path),
      })),
    { dryRun: options.dryRun === true },
  );
  const additionalCandidates = impacts
    .filter((impact) => !persistedIds.has(impact.decisionId))
    .reduce((sum, impact) => sum + impact.candidates.length, 0);
  const added = updated.added + additionalCandidates;
  const addedCandidates: ImpactCandidateAddition[] = [
    ...updated.addedCandidates.map(({ id, path }) => ({ decisionId: id, path })),
    ...impacts
      .filter((impact) => !persistedIds.has(impact.decisionId))
      .flatMap((impact) =>
        impact.candidates.map((candidate) => ({
          decisionId: impact.decisionId,
          path: candidate.path,
        })),
      ),
  ];

  const previousRepositories = new Map(
    state.repositories.map((repository) => [repository.path, repository]),
  );
  if (options.dryRun !== true) {
    await writeState(workspace.paths, {
      ...state,
      lastScanAt: scannedAt,
      repositories: discovery.repositories.map((repository) => ({
        ...(previousRepositories.get(repository.relativePath) ?? {}),
        path: repository.relativePath,
        lastSeenAt: scannedAt,
      })),
      errors: errors.map((error) => ({ message: error.message, path: error.path, at: scannedAt })),
    });
  }

  const candidateCount = impacts.reduce((sum, impact) => sum + impact.candidates.length, 0);
  if (options.quiet !== true) {
    workspace.io.out(
      `Scanned ${discovery.repositories.length} repositories for ${decisions.length} decisions.`,
    );
    workspace.io.out(`Found ${candidateCount} candidate impacts (${added} newly recorded).`);
    for (const error of errors) workspace.io.err(`  error ${error.path}: ${error.message}`);
  }

  return {
    repositories: discovery.repositories.length,
    decisions: decisions.length,
    candidates: candidateCount,
    added,
    addedCandidates,
    impacts,
    targets,
    errors,
  };
}

interface LocatedImpactCandidate extends ImpactCandidate {
  readonly repositoryPath: string;
  readonly repositoryRelativePath: string;
}

function impactTargets(
  decisionId: string,
  candidates: readonly LocatedImpactCandidate[],
): readonly ImpactTarget[] {
  const repositoryPaths = [...new Set(candidates.map(({ repositoryPath }) => repositoryPath))].sort(
    compareText,
  );
  return repositoryPaths.map((repositoryPath) => ({
    decisionId,
    repositoryPath,
    candidatePaths: candidates
      .filter((candidate) => candidate.repositoryPath === repositoryPath)
      .map(({ repositoryRelativePath }) => repositoryRelativePath),
  }));
}

/** Git supplies the authoritative `.gitignore` implementation for each repo. */
function gitFiles(repositoryPath: string): Promise<readonly string[]> {
  return new Promise((done, reject) => {
    execFile(
      "git",
      ["-C", repositoryPath, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8", maxBuffer: GIT_OUTPUT_BUFFER_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`Could not enumerate repository files: ${detail}`));
          return;
        }
        done(
          stdout
            .split("\0")
            .filter((path) => path !== "")
            .sort(),
        );
      },
    );
  });
}

async function readableText(path: string): Promise<string | undefined> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_TEXT_FILE_BYTES) {
    return undefined;
  }
  const buffer = await readFile(path);
  if (buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
}

function isScannablePath(path: string): boolean {
  const portable = path.replace(/\\/g, "/");
  const segments = portable.split("/");
  if (segments.some((segment) => segment === ".git" || IGNORED_DIRECTORY_NAMES.includes(segment))) {
    return false;
  }
  const name = basename(portable).toLowerCase();
  return TEXT_EXTENSIONS.has(extname(name)) || TEXT_FILE_NAMES.has(name) || name.startsWith(".env.");
}

function wordCounts(value: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const word of wordsOf(value)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

function compareCandidates(left: ImpactCandidate, right: ImpactCandidate): number {
  return (
    right.matchedKeywords.length - left.matchedKeywords.length ||
    right.occurrences - left.occurrences ||
    compareText(left.path, right.path)
  );
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function workspaceRelativePath(repository: Repository, repoRelativePath: string): string {
  const portable = repoRelativePath.replace(/\\/g, "/");
  return repository.relativePath === "." ? portable : `${repository.relativePath}/${portable}`;
}

function displayPath(repository: Repository, repoRelativePath: string): string {
  const portable = repoRelativePath.replace(/\\/g, "/");
  return `${repository.name}/${portable}`;
}

function isDecisionSource(
  source: string | undefined,
  workspacePath: string,
  display: string,
): boolean {
  if (source === undefined) return false;
  const sourcePath = source.replace(/#L\d+(?:-L\d+)?$/, "").replace(/\\/g, "/");
  return sourcePath === workspacePath || sourcePath === display;
}

function isInside(root: string, path: string): boolean {
  const rest = relative(root, path);
  return rest !== "" && rest !== ".." && !rest.startsWith(`..${sep}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { deriveKeywords } from "../keywords.js";
