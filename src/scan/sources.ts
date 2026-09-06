import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { AmanosError } from "../errors.js";
import { isSupportedSource } from "../parser/index.js";
import { IGNORED_DIRECTORY_NAMES } from "../repos/index.js";
import type { WorkspacePaths } from "../workspace/index.js";

export interface SourceFile {
  /** Workspace-relative path with forward slashes. */
  readonly path: string;
  readonly content: string;
}

export interface SourceReadError {
  readonly path: string;
  readonly message: string;
}

export interface SourceReadResult {
  readonly files: readonly SourceFile[];
  readonly errors: readonly SourceReadError[];
}

const IGNORED_DIRECTORIES = new Set([".git", ...IGNORED_DIRECTORY_NAMES]);

/** Reads supported free-text sources without following links or amanos-owned data. */
export async function readSourceFiles(paths: WorkspacePaths): Promise<SourceReadResult> {
  const candidates: string[] = [];
  const errors: SourceReadError[] = [];
  const queue = [paths.root];

  while (queue.length > 0) {
    const directory = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === paths.root) {
        throw new AmanosError(`Workspace "${paths.root}" is not readable: ${describe(error)}`);
      }
      errors.push({
        path: display(paths.root, directory),
        message: `Could not read directory: ${describe(error)}`,
      });
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(absolutePath);
        continue;
      }
      if (
        entry.isFile() &&
        absolutePath !== paths.decisions &&
        isSupportedSource(entry.name)
      ) {
        candidates.push(absolutePath);
      }
    }
  }

  const files: SourceFile[] = [];
  for (const path of candidates.sort(compareText)) {
    const relativePath = display(paths.root, path);
    try {
      files.push({ path: relativePath, content: await readFile(path, "utf8") });
    } catch (error) {
      errors.push({ path: relativePath, message: `Could not read source: ${describe(error)}` });
    }
  }

  return { files, errors: errors.sort(comparePaths) };
}

function display(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function comparePaths(left: { readonly path: string }, right: { readonly path: string }): number {
  return compareText(left.path, right.path);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
