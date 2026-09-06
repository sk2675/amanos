import type { Decision } from "../parser/index.js";

/** Source material supplied to an agent, kept separate from the parsed finding. */
export interface AgentSource {
  /** Workspace-relative path with forward slashes. */
  readonly path: string;
  readonly content: string;
}

/** Everything an adapter needs to prepare one decision in one repository. */
export interface AgentRequest {
  readonly decisionId: string;
  readonly decision: Decision;
  readonly sources: readonly AgentSource[];
  /** Absolute path of the repository the adapter may work in. */
  readonly repositoryPath: string;
  /** Candidate files relative to `repositoryPath`, ranked most relevant first. */
  readonly candidatePaths: readonly string[];
}

/** The concrete work an adapter planned before changing a repository. */
export interface AgentPlan {
  readonly summary: string;
  readonly files: readonly string[];
  readonly tests: readonly string[];
}

export interface AgentSuccess {
  readonly kind: "success";
  readonly plan: AgentPlan;
  readonly branch: string;
  readonly commit: string;
}

export interface AgentTestFailure {
  readonly kind: "test-failure";
  readonly plan: AgentPlan;
  readonly branch: string;
  readonly error: string;
  readonly nextStep: string;
}

export interface AgentAborted {
  readonly kind: "aborted";
  readonly reason: string;
}

/** Every completed adapter invocation has exactly one explicit outcome. */
export type AgentResult = AgentSuccess | AgentTestFailure | AgentAborted;

/**
 * Seam for a locally installed coding agent.
 *
 * Safety invariant for every future adapter implementation: work must be
 * isolated on a new local branch. An adapter must never push, merge, or modify
 * the branch that was active when it was invoked.
 */
export interface AgentAdapter {
  readonly name: string;
  prepare(request: AgentRequest): Promise<AgentResult>;
}

export type AgentAdapterFactory = (configuredName: string) => AgentAdapter;

export const V1_AGENT_DISABLED_REASON = "Agent execution is disabled in V1.";

/**
 * V1 deliberately resolves every configured agent name to this adapter. It
 * neither launches a process nor reads or writes a repository.
 */
export class NoOpAgentAdapter implements AgentAdapter {
  constructor(readonly name: string) {}

  prepare(_request: AgentRequest): Promise<AgentAborted> {
    return Promise.resolve({ kind: "aborted", reason: V1_AGENT_DISABLED_REASON });
  }
}

/** Reads the configured name while keeping agent execution disabled in V1. */
export function createAgentAdapter(name: string): AgentAdapter {
  return new NoOpAgentAdapter(name);
}
