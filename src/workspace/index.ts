import type { Io } from "../io.js";
import { resolveWorkspace, type WorkspacePaths } from "./paths.js";

/**
 * Everything a command needs, created once per invocation and passed down.
 * Config and state are read on demand so `init` can run before they exist.
 */
export interface Workspace {
  readonly paths: WorkspacePaths;
  readonly io: Io;
}

/** Validates the workspace argument and builds the context for one command. */
export async function openWorkspace(workspace: string, io: Io): Promise<Workspace> {
  return { paths: await resolveWorkspace(workspace), io };
}

export {
  AMANOS_DIR_NAME,
  CONFIG_FILE_NAME,
  DECISIONS_FILE_NAME,
  STATE_FILE_NAME,
  resolveWorkspace,
  workspacePaths,
  type WorkspacePaths,
} from "./paths.js";
export {
  DECISION_STATUSES,
  DEFAULT_CONFIG,
  parseConfig,
  readConfig,
  writeConfig,
  type ActivationConfig,
  type DecisionStatus,
  type WorkspaceConfig,
} from "./config.js";
export {
  INITIAL_STATE,
  parseState,
  readState,
  writeState,
  type KnownRepository,
  type RecordedError,
  type WorkspaceState,
} from "./state.js";
