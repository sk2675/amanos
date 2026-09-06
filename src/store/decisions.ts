import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "../atomic.js";
import { AmanosError } from "../errors.js";
import { duplicateKey, type Decision } from "../parser/index.js";
import {
  readState,
  writeState,
  type DecisionStatus,
  type WorkspacePaths,
} from "../workspace/index.js";

/**
 * The head of a fresh DECISIONS.md. Everything amanos finds later is appended
 * below it, so this text is written exactly once — at init.
 */
export const DECISIONS_HEADER = [
  "# Decisions",
  "",
  "This file is maintained by amanos and is append-only: entries are added, never",
  "rewritten or removed. Edit it by hand only if you are willing to keep that rule.",
  "",
].join("\n");

/** A decision heading and the machine-readable fields found below it. */
export interface StoredDecision {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** Unknown handwritten values are exposed but never normalised away. */
  readonly status: string | undefined;
  readonly confidence: number | undefined;
  readonly detectedAt: string | undefined;
  readonly source: string | undefined;
  /** Character offsets in {@link DecisionFile.content}; `end` is exclusive. */
  readonly start: number;
  readonly end: number;
  /** Character offsets of the status value itself, when a Status line exists. */
  readonly statusStart: number | undefined;
  readonly statusEnd: number | undefined;
}

/**
 * A lossless view of DECISIONS.md. `content` remains the source of truth so a
 * parse/serialise round-trip cannot reformat handwritten Markdown.
 */
export interface DecisionFile {
  readonly content: string;
  readonly decisions: readonly StoredDecision[];
  readonly usedIds: readonly string[];
  readonly highestDecisionNumber: number;
}

export interface AppendedDecision {
  readonly id: string;
  readonly decision: Decision;
}

export interface AppendDecisionsResult {
  readonly appended: readonly AppendedDecision[];
  readonly skipped: number;
  readonly nextDecisionNumber: number;
}

export interface StatusUpdateResult {
  readonly id: string;
  readonly previousStatus: string;
  readonly status: DecisionStatus;
  readonly changed: boolean;
}

const ENTRY_HEADING = /^##[ \t]+(D-(\d+))[ \t]+(?:—|–|-)[ \t]+(.+?)[ \t]*\r?$/gm;
const USED_ID = /^##[ \t]+(D-(\d+))\b/gm;

/** Parses known fields without ever rebuilding or otherwise changing the file. */
export function parseDecisionFile(content: string): DecisionFile {
  const headings = [...content.matchAll(ENTRY_HEADING)];
  const decisions = headings.map((heading, index): StoredDecision => {
    const id = heading[1] as string;
    const number = Number.parseInt(heading[2] as string, 10);
    const title = heading[3] as string;
    const start = heading.index;
    const end = headings[index + 1]?.index ?? content.length;
    const headingEnd = start + heading[0].length;
    const body = content.slice(headingEnd, end);
    const status = field(body, "Status", headingEnd);

    return {
      id,
      number,
      title,
      status: status?.value,
      confidence: integerField(body, "Confidence"),
      detectedAt: field(body, "Erkannt", headingEnd)?.value,
      source: field(body, "Quelle", headingEnd)?.value,
      start,
      end,
      statusStart: status?.start,
      statusEnd: status?.end,
    };
  });

  // Even a manually malformed decision heading reserves its ID. Reusing it
  // would be more damaging than leaving a harmless gap in the sequence.
  const used = [...content.matchAll(USED_ID)].map((match) => ({
    id: match[1] as string,
    number: Number.parseInt(match[2] as string, 10),
  }));

  return {
    content,
    decisions,
    usedIds: used.map(({ id }) => id),
    highestDecisionNumber: used.reduce((highest, entry) => Math.max(highest, entry.number), 0),
  };
}

/** Returning the original source is deliberately the only serialisation step. */
export function serialiseDecisionFile(file: DecisionFile): string {
  return file.content;
}

/** Reads DECISIONS.md and points users at `amanos init` when it is absent. */
export async function readDecisionFile(paths: WorkspacePaths): Promise<DecisionFile> {
  let content: string;
  try {
    content = await readFile(paths.decisions, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AmanosError(
        `${paths.decisions} is missing. Run "amanos init ${paths.root}" to set up the workspace.`,
      );
    }
    throw new AmanosError(`Could not read ${paths.decisions}: ${describe(error)}`);
  }
  return parseDecisionFile(content);
}

/**
 * Adds findings which are not already represented by the same statement and
 * source file. Existing bytes are only ever used as the prefix of the write.
 *
 * The state counter is a persistent high-water mark. Combining it with the
 * IDs still present in DECISIONS.md means deleting D-003 by hand never makes
 * D-003 available again.
 */
export async function appendDecisions(
  paths: WorkspacePaths,
  findings: readonly Decision[],
): Promise<AppendDecisionsResult> {
  const [file, state] = await Promise.all([readDecisionFile(paths), readState(paths)]);
  const usedNumbers = new Set(file.usedIds.map(numberOfId));
  const known = new Set(
    file.decisions.flatMap((entry) => {
      if (entry.source === undefined) return [];
      return [duplicateKey(sourcePath(entry.source), entry.title)];
    }),
  );
  const appended: AppendedDecision[] = [];
  let content = file.content;
  let candidate = Math.max(state.nextDecisionNumber, file.highestDecisionNumber + 1);

  for (const decision of findings) {
    const statement = oneLine(decision.statement);
    if (statement === "") {
      throw new AmanosError("Could not append a decision with an empty statement.");
    }
    const key = duplicateKey(decision.sourcePath, statement);
    if (known.has(key)) {
      continue;
    }

    while (usedNumbers.has(candidate)) candidate += 1;
    const id = formatDecisionId(candidate);
    content = appendBlock(content, formatDecision(id, decision, statement));
    appended.push({ id, decision });
    known.add(key);
    usedNumbers.add(candidate);
    candidate += 1;
  }

  const nextDecisionNumber = Math.max(candidate, file.highestDecisionNumber + 1);

  // A no-op scan does not touch DECISIONS.md. This is stronger than merely
  // producing equal text: timestamps and file watchers remain undisturbed.
  if (appended.length > 0) {
    await writeFileAtomic(paths.decisions, content);
  }
  if (state.nextDecisionNumber !== nextDecisionNumber) {
    await writeState(paths, { ...state, nextDecisionNumber });
  }

  return {
    appended,
    skipped: findings.length - appended.length,
    nextDecisionNumber,
  };
}

/**
 * Changes precisely the value on an existing Status line and inserts an audit
 * note into the same entry. Every other byte, including user notes, survives.
 */
export async function updateDecisionStatus(
  paths: WorkspacePaths,
  id: string,
  status: DecisionStatus,
  changedAt = new Date().toISOString(),
): Promise<StatusUpdateResult> {
  const file = await readDecisionFile(paths);
  const entry = file.decisions.find((decision) => decision.id === id);
  if (entry === undefined) {
    throw new AmanosError(`Decision ${id} was not found in ${paths.decisions}.`);
  }
  if (entry.status === undefined || entry.statusStart === undefined || entry.statusEnd === undefined) {
    throw new AmanosError(`Decision ${id} has no Status line in ${paths.decisions}.`);
  }
  if (entry.status === status) {
    return { id, previousStatus: entry.status, status, changed: false };
  }

  const withStatus =
    file.content.slice(0, entry.statusStart) + status + file.content.slice(entry.statusEnd);
  const offsetDelta = status.length - (entry.statusEnd - entry.statusStart);
  const note = `Hinweis: Status am ${dateOnly(changedAt)} von ${entry.status} auf ${status} geändert.`;
  const content = insertBlock(withStatus, entry.end + offsetDelta, note);

  await writeFileAtomic(paths.decisions, content);
  return { id, previousStatus: entry.status, status, changed: true };
}

/** D-1 and D-001 both become the canonical fixed-width form D-001. */
export function formatDecisionId(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new AmanosError(`Decision number must be a positive whole number, found ${number}.`);
  }
  return `D-${String(number).padStart(3, "0")}`;
}

function formatDecision(id: string, decision: Decision, statement: string): string {
  return [
    `## ${id} — ${statement}`,
    "",
    `Status: ${decision.status}`,
    `Confidence: ${Math.round(decision.confidence)} %`,
    `Erkannt: ${dateOnly(decision.detectedAt)}`,
    `Quelle: ${oneLine(decision.location)}`,
    "",
    "### Auswirkungen",
    "",
    "- [ ] Noch nicht analysiert",
  ].join("\n");
}

function appendBlock(content: string, block: string): string {
  const newline = newlineOf(content);
  const normalisedBlock = block.replace(/\n/g, newline);
  if (content === "") return `${normalisedBlock}${newline}`;
  const separator = content.endsWith(`${newline}${newline}`)
    ? ""
    : content.endsWith(newline)
      ? newline
      : `${newline}${newline}`;
  return `${content}${separator}${normalisedBlock}${newline}`;
}

function insertBlock(content: string, offset: number, block: string): string {
  const newline = newlineOf(content);
  const before = content.slice(0, offset);
  const after = content.slice(offset);
  const beforeSeparator = before.endsWith(`${newline}${newline}`)
    ? ""
    : before.endsWith(newline)
      ? newline
      : `${newline}${newline}`;
  const afterSeparator = after === "" ? newline : `${newline}${newline}`;
  return `${before}${beforeSeparator}${block}${afterSeparator}${after}`;
}

function newlineOf(content: string): "\r\n" | "\n" | "\r" {
  const match = /\r\n|\n|\r/.exec(content);
  return (match?.[0] as "\r\n" | "\n" | "\r" | undefined) ?? "\n";
}

function field(
  body: string,
  name: string,
  bodyOffset: number,
): { readonly value: string; readonly start: number; readonly end: number } | undefined {
  const pattern = new RegExp(`^${name}:([ \\t]*)([^\\r\\n]*?)([ \\t]*)\\r?$`, "m");
  const match = pattern.exec(body);
  if (match === null) return undefined;
  const leading = match[1] as string;
  const value = match[2] as string;
  const start = bodyOffset + match.index + name.length + 1 + leading.length;
  return { value, start, end: start + value.length };
}

function integerField(body: string, name: string): number | undefined {
  const found = field(body, name, 0)?.value.match(/^(\d+)(?:[ \t]*%)?$/)?.[1];
  return found === undefined ? undefined : Number.parseInt(found, 10);
}

function sourcePath(location: string): string {
  return location.replace(/#L\d+(?:-L\d+)?$/, "");
}

function numberOfId(id: string): number {
  return Number.parseInt(id.slice(2), 10);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dateOnly(value: string): string {
  const date = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value)?.[1];
  if (date === undefined) {
    throw new AmanosError(`Expected an ISO 8601 date, found ${JSON.stringify(value)}.`);
  }
  return date;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
