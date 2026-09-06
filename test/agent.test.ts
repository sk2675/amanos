import { describe, expect, it } from "vitest";

import {
  createAgentAdapter,
  NoOpAgentAdapter,
  V1_AGENT_DISABLED_REASON,
  type AgentResult,
} from "../src/agent/index.js";
import { parseDecisions } from "../src/parser/index.js";

describe("agent adapter seam", () => {
  it("resolves the configured name to the V1 no-op without requiring an installed agent", async () => {
    const [decision] = parseDecisions(
      "notes/pricing.md",
      "We decided the Pro plan costs 29 EUR per month.",
      { detectedAt: "2026-09-06T12:00:00.000Z" },
    );
    if (decision === undefined) throw new Error("Expected a decision fixture.");

    const adapter = createAgentAdapter("codex");
    const result = await adapter.prepare({
      decisionId: "D-001",
      decision,
      sources: [{ path: decision.sourcePath, content: decision.statement }],
      repositoryPath: "C:/workspace/app-repo",
      candidatePaths: ["src/pricing.ts"],
    });

    expect(adapter).toBeInstanceOf(NoOpAgentAdapter);
    expect(adapter.name).toBe("codex");
    expect(result).toEqual({ kind: "aborted", reason: V1_AGENT_DISABLED_REASON });
  });

  it("models success, test failure and abort as distinct outcomes", () => {
    const outcomes: readonly AgentResult[] = [
      {
        kind: "success",
        plan: { summary: "Update pricing", files: ["src/pricing.ts"], tests: ["npm test"] },
        branch: "amanos/D-001-pricing",
        commit: "abc123",
      },
      {
        kind: "test-failure",
        plan: { summary: "Update pricing", files: ["src/pricing.ts"], tests: ["npm test"] },
        branch: "amanos/D-001-pricing",
        error: "npm test exited with code 1",
        nextStep: "Inspect the pricing test failure.",
      },
      { kind: "aborted", reason: "Cancelled before changing files." },
    ];

    expect(outcomes.map(({ kind }) => kind)).toEqual(["success", "test-failure", "aborted"]);
  });
});
