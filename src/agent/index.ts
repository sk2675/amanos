import { NotImplementedError } from "../errors.js";
import type { Decision } from "../parser/index.js";

export interface AgentRequest {
  readonly decision: Decision;
  readonly repositoryPath: string;
  readonly candidatePaths: readonly string[];
}

export interface AgentResult {
  readonly branch: string;
  readonly summary: string;
}

/** Adapter for a locally installed coding agent. Wired up after V1. */
export interface AgentAdapter {
  readonly name: string;
  prepare(request: AgentRequest): Promise<AgentResult>;
}

export function createAgentAdapter(name: string): AgentAdapter {
  throw new NotImplementedError(`the "${name}" agent adapter`);
}
