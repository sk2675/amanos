import { NotImplementedError } from "../errors.js";

/** A git repository found inside the workspace. */
export interface Repository {
  readonly path: string;
}

/** Finds all git repositories inside the workspace, including nested ones. */
export async function discoverRepositories(_workspace: string): Promise<readonly Repository[]> {
  throw new NotImplementedError("repository discovery");
}
