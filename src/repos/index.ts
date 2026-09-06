import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { AmanosError } from "../errors.js";

/** A git repository found inside the workspace. */
export interface Repository {
  /** Absolute path of the repository root. */
  readonly path: string;
  /** Path relative to the workspace root, with forward slashes, like KnownRepository. */
  readonly relativePath: string;
  /** The directory name, used wherever a repository is mentioned in output. */
  readonly name: string;
}

/** A directory that could not be read; the caller records it in the state. */
export interface DiscoveryError {
  readonly message: string;
  /** The unreadable directory, relative to the workspace, with forward slashes. */
  readonly path: string;
}

/** Everything one scan learned: the repositories and what stayed unreadable. */
export interface DiscoveryResult {
  readonly repositories: readonly Repository[];
  readonly errors: readonly DiscoveryError[];
}

/** Directories that never contain repositories worth scanning. */
export const IGNORED_DIRECTORY_NAMES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  ".amanos",
  ".next",
  ".cache",
  "coverage",
  "vendor",
];

const GIT_ENTRY_NAME = ".git";

/**
 * Finds all git repositories inside the workspace, including nested ones.
 *
 * A repository is any directory holding a `.git` entry — a directory, or a file
 * for worktrees and submodules. The walk never descends into `.git` itself, so
 * a repository's own object store cannot masquerade as a nested repository.
 * Unreadable directories are collected instead of aborting the scan.
 */
export async function discoverRepositories(workspace: string): Promise<DiscoveryResult> {
  const root = workspace;
  const repositories: Repository[] = [];
  const errors: DiscoveryError[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const directory = queue.shift() as string;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // The workspace root itself is the caller's mistake, everything below it is not.
      if (directory === root) {
        throw new AmanosError(`Workspace "${root}" is not readable: ${reasonOf(error)}`);
      }
      errors.push({
        message: `Could not read "${workspaceRelative(root, directory)}": ${reasonOf(error)}`,
        path: workspaceRelative(root, directory),
      });
      continue;
    }

    if (entries.some((entry) => entry.name === GIT_ENTRY_NAME && !entry.isSymbolicLink())) {
      repositories.push({
        path: directory,
        relativePath: workspaceRelative(root, directory),
        name: basename(directory),
      });
    }

    for (const entry of entries) {
      // Symlinks are left alone so a loop can never turn the walk into a hang.
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name === GIT_ENTRY_NAME || IGNORED_DIRECTORY_NAMES.includes(entry.name)) continue;
      queue.push(join(directory, entry.name));
    }
  }

  return {
    repositories: repositories.sort(byPath),
    errors: errors.sort(byPath),
  };
}

/** The workspace root itself is "."; everything below uses forward slashes. */
function workspaceRelative(root: string, path: string): string {
  const rest = relative(root, path);
  return rest === "" ? "." : rest.split(sep).join("/");
}

/** Ordering is by path so two scans of the same workspace read identically. */
function byPath(a: { readonly path: string }, b: { readonly path: string }): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
