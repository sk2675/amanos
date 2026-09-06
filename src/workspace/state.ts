import { writeJsonAtomic } from "../atomic.js";
import { readWorkspaceFile } from "./config.js";
import type { WorkspacePaths } from "./paths.js";
import { type JsonObject, readJsonObject } from "./validate.js";

/** A repository amanos has seen inside this workspace. */
export interface KnownRepository {
  /** Path relative to the workspace root, with forward slashes. */
  readonly path: string;
  readonly lastSeenAt: string | null;
  readonly [unknownField: string]: unknown;
}

/** Something went wrong and must stay visible instead of being swallowed. */
export interface RecordedError {
  readonly message: string;
  readonly at: string | null;
  /** The file or repository the error belongs to, if any. */
  readonly path: string | null;
  readonly [unknownField: string]: unknown;
}

export interface WorkspaceState {
  readonly lastScanAt: string | null;
  /** The number the next decision gets, so IDs stay stable and increasing. */
  readonly nextDecisionNumber: number;
  readonly repositories: readonly KnownRepository[];
  readonly errors: readonly RecordedError[];
  /** Fields written by another amanos version, kept verbatim. */
  readonly [unknownField: string]: unknown;
}

export const INITIAL_STATE: WorkspaceState = {
  lastScanAt: null,
  nextDecisionNumber: 1,
  repositories: [],
  errors: [],
};

/** Same contract as parseConfig: defaults fill in, unknown fields survive. */
export function parseState(file: string, text: string): WorkspaceState {
  const reader = readJsonObject(file, text);

  const known: JsonObject = {
    lastScanAt: reader.isoDateOrNull("lastScanAt", INITIAL_STATE.lastScanAt),
    nextDecisionNumber: reader.integer("nextDecisionNumber", INITIAL_STATE.nextDecisionNumber, {
      min: 1,
    }),
    repositories: reader.array<KnownRepository>("repositories", INITIAL_STATE.repositories, (entry) => ({
      ...entry.raw,
      path: entry.requiredString("path"),
      lastSeenAt: entry.isoDateOrNull("lastSeenAt", null),
    })),
    errors: reader.array<RecordedError>("errors", INITIAL_STATE.errors, (entry) => ({
      ...entry.raw,
      message: entry.requiredString("message"),
      at: entry.isoDateOrNull("at", null),
      path: entry.has("path") ? entry.requiredString("path") : null,
    })),
  };

  return { ...reader.raw, ...known } as WorkspaceState;
}

export async function readState(paths: WorkspacePaths): Promise<WorkspaceState> {
  return parseState(paths.state, await readWorkspaceFile(paths.state, paths.root));
}

export async function writeState(
  paths: WorkspacePaths,
  state: WorkspaceState = INITIAL_STATE,
): Promise<void> {
  await writeJsonAtomic(paths.state, state);
}
