import { readFile } from "node:fs/promises";

import { AmanosError } from "../errors.js";
import { writeJsonAtomic } from "../atomic.js";
import { type JsonObject, readJsonObject } from "./validate.js";
import type { WorkspacePaths } from "./paths.js";

/** The status a freshly detected decision gets. */
export const DECISION_STATUSES = ["active", "draft", "blocked", "done"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export interface ActivationConfig {
  readonly defaultStatus: DecisionStatus;
  /** Findings below this confidence are recorded as drafts. */
  readonly draftBelowConfidence: number;
  readonly [unknownField: string]: unknown;
}

export interface WorkspaceConfig {
  /** Seconds without a file change before the watcher starts a scan. */
  readonly quietPeriodSeconds: number;
  readonly activation: ActivationConfig;
  /** Name of the coding agent adapter; only used from phase 2 onwards. */
  readonly agent: string;
  /** Fields written by another amanos version, kept verbatim. */
  readonly [unknownField: string]: unknown;
}

export const DEFAULT_CONFIG: WorkspaceConfig = {
  quietPeriodSeconds: 60,
  activation: {
    defaultStatus: "active",
    draftBelowConfidence: 70,
  },
  agent: "codex",
};

/**
 * Validates a config file. Missing fields fall back to the defaults, unknown
 * fields survive untouched, wrong values are rejected with a readable message.
 */
export function parseConfig(file: string, text: string): WorkspaceConfig {
  const reader = readJsonObject(file, text);
  const activation = reader.has("activation")
    ? reader.object("activation")
    : undefined;

  const known: JsonObject = {
    quietPeriodSeconds: reader.integer("quietPeriodSeconds", DEFAULT_CONFIG.quietPeriodSeconds, {
      min: 1,
      max: 86_400,
    }),
    activation: {
      ...(activation?.raw ?? {}),
      defaultStatus:
        activation?.oneOf("defaultStatus", DECISION_STATUSES, DEFAULT_CONFIG.activation.defaultStatus) ??
        DEFAULT_CONFIG.activation.defaultStatus,
      draftBelowConfidence:
        activation?.integer("draftBelowConfidence", DEFAULT_CONFIG.activation.draftBelowConfidence, {
          min: 0,
          max: 100,
        }) ?? DEFAULT_CONFIG.activation.draftBelowConfidence,
    },
    agent: reader.string("agent", DEFAULT_CONFIG.agent),
  };

  return { ...reader.raw, ...known } as WorkspaceConfig;
}

/** Reads the config; a missing file is reported as "run amanos init". */
export async function readConfig(paths: WorkspacePaths): Promise<WorkspaceConfig> {
  return parseConfig(paths.config, await readWorkspaceFile(paths.config, paths.root));
}

export async function writeConfig(
  paths: WorkspacePaths,
  config: WorkspaceConfig = DEFAULT_CONFIG,
): Promise<void> {
  await writeJsonAtomic(paths.config, config);
}

/** Shared by config and state so both report a missing workspace the same way. */
export async function readWorkspaceFile(file: string, root: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new AmanosError(
        `${file} is missing. Run "amanos init ${root}" to set up the workspace.`,
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AmanosError(`Could not read ${file}: ${reason}`);
  }
}
