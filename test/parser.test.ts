import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHRASES,
  MAX_STATEMENT_LENGTH,
  duplicateKey,
  extractSourceText,
  isSupportedSource,
  parseDecisions,
  type Decision,
} from "../src/parser/index.js";
import { DEFAULT_CONFIG, parseConfig } from "../src/workspace/index.js";

/** A fixed timestamp keeps every expectation reproducible. */
const detectedAt = "2026-09-05T10:00:00.000Z";

async function fixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), "utf8");
}

/** The reported lines, taken from the original file exactly as a reader would. */
function sourceLines(content: string, decision: Decision): string {
  return content
    .split(/\r\n|\n|\r/)
    .slice(decision.startLine - 1, decision.endLine)
    .join(" ");
}

describe("parseDecisions on Markdown", () => {
  it("finds the German decisions and skips prose and code fences", async () => {
    const content = await fixture("pricing-de.md");

    const found = parseDecisions("notes/pricing-de.md", content, { detectedAt });

    expect(
      found.map((decision) => [decision.location, decision.confidence, decision.status]),
    ).toEqual([
      ["notes/pricing-de.md#L3", 86, "active"],
      ["notes/pricing-de.md#L8-L9", 84, "active"],
      ["notes/pricing-de.md#L17", 32, "draft"],
    ]);
    expect(found[0]?.statement).toBe(
      "Wir haben entschieden, dass der Pro-Plan 29 € pro Monat kostet.",
    );
    expect(found[1]?.statement).toBe(
      "Am Ende haben wir beschlossen, die API auf AWS zu betreiben, weil das Team dort bereits Erfahrung hat.",
    );
    expect(found[2]?.statement).toBe("Ab jetzt laufen Reviews über Pull Requests.");
    expect(found.every((decision) => decision.detectedAt === detectedAt)).toBe(true);
  });

  it("finds the English decisions and grades them by phrase and context", async () => {
    const content = await fixture("roadmap-en.md");

    const found = parseDecisions("notes/roadmap-en.md", content, { detectedAt });

    expect(
      found.map((decision) => [decision.location, decision.signals.phrase, decision.confidence]),
    ).toEqual([
      ["notes/roadmap-en.md#L3", "decision:", 96],
      ["notes/roadmap-en.md#L5", "we decided", 77],
      ["notes/roadmap-en.md#L9", "we will", 50],
      ["notes/roadmap-en.md#L11", "from now on", 41],
    ]);
    expect(found.map((decision) => decision.status)).toEqual([
      "active",
      "active",
      "draft",
      "draft",
    ]);
  });

  it("reads plain text files too", async () => {
    const found = parseDecisions("notes/meeting-en.txt", await fixture("meeting-en.txt"), {
      detectedAt,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.statement).toBe("We decided to ship on Friday.");
    expect(found[0]?.location).toBe("notes/meeting-en.txt#L3");
    // No heading above it, nothing concrete in it: stays a draft.
    expect(found[0]?.confidence).toBe(56);
  });

  it("reports nothing for notes without a decision", async () => {
    expect(parseDecisions("notes/no-decision.md", await fixture("no-decision.md"), { detectedAt }))
      .toEqual([]);
  });
});

describe("parseDecisions on HTML", () => {
  it("reads visible text and keeps the line numbers of the source file", async () => {
    const content = await fixture("pricing-de.html");

    const found = parseDecisions("site/pricing-de.html", content, { detectedAt });

    expect(found.map((decision) => decision.location)).toEqual([
      "site/pricing-de.html#L12",
      "site/pricing-de.html#L15",
    ]);
    expect(found[0]?.statement).toBe(
      "Wir haben beschlossen, den Pro-Plan bei 29 € zu lassen.",
    );
    expect(found[0]?.confidence).toBe(86);
    expect(found[1]?.confidence).toBe(51);
    expect(sourceLines(content, found[0] as Decision)).toContain("beschlossen");
  });

  it("ignores script, style and comments, and spans several lines when the sentence does", async () => {
    const content = await fixture("roadmap-en.html");

    const found = parseDecisions("site/roadmap-en.html", content, { detectedAt });

    expect(found).toHaveLength(1);
    expect(found[0]?.location).toBe("site/roadmap-en.html#L6-L7");
    expect(found[0]?.statement).toBe(
      "We decided to move the worker queue to RabbitMQ because the current cron setup is too slow.",
    );
    expect(sourceLines(content, found[0] as Decision)).toContain("RabbitMQ");
  });

  it("keeps one text line per source line", async () => {
    const content = await fixture("roadmap-en.html");
    const source = extractSourceText("site/roadmap-en.html", content);

    expect(source.lines).toHaveLength(content.split("\n").length);
    expect(source.lines[5]?.trim()).toBe("We decided to move the worker queue to RabbitMQ");
    expect(source.headingLines).toEqual(new Set([4]));
  });
});

describe("confidence", () => {
  it("is the documented sum of its signals", async () => {
    const [decision] = parseDecisions("notes/roadmap-en.md", await fixture("roadmap-en.md"), {
      detectedAt,
    });
    const signals = decision?.signals;

    expect(signals).toEqual({
      phrase: "decision:",
      phraseStrength: "strong",
      phrasePoints: 50,
      headingPoints: 18,
      numberPoints: 12,
      properNounPoints: 10,
      detailPoints: 6,
    });
    expect(decision?.confidence).toBe(96);
  });

  it("returns the same value for the same input", async () => {
    const content = await fixture("pricing-de.md");

    expect(parseDecisions("notes/pricing-de.md", content, { detectedAt })).toEqual(
      parseDecisions("notes/pricing-de.md", content, { detectedAt }),
    );
  });

  it("prefers the strongest phrase in a sentence, whatever the list order", () => {
    const [decision] = parseDecisions("a.md", "We will ship it, decision: we ship on Monday.", {
      detectedAt,
      phrases: [...DEFAULT_PHRASES].reverse(),
    });

    expect(decision?.signals.phrase).toBe("decision:");
    expect(decision?.signals.phraseStrength).toBe("strong");
  });
});

describe("status and duplicates", () => {
  it("takes the threshold and the default status from the config", async () => {
    const content = await fixture("roadmap-en.md");
    const config = parseConfig("config.json", JSON.stringify({ activation: { draftBelowConfidence: 40 } }));

    const found = parseDecisions("notes/roadmap-en.md", content, { detectedAt, config });

    expect(found.map((decision) => decision.status)).toEqual([
      "active",
      "active",
      "active",
      "active",
    ]);
    expect(
      parseDecisions("notes/roadmap-en.md", content, {
        detectedAt,
        config: { ...DEFAULT_CONFIG, activation: { ...DEFAULT_CONFIG.activation, draftBelowConfidence: 100 } },
      }).every((decision) => decision.status === "draft"),
    ).toBe(true);
  });

  it("reports the same statement from the same source only once", () => {
    const content = [
      "# Pricing",
      "",
      "We decided to charge 29 EUR.",
      "",
      "Some other note.",
      "",
      "we decided to charge 29 EUR!",
    ].join("\n");

    const found = parseDecisions("notes/pricing.md", content, { detectedAt });

    expect(found).toHaveLength(1);
    expect(found[0]?.startLine).toBe(3);
    expect(duplicateKey("notes/pricing.md", "We decided to charge 29 EUR.")).toBe(
      duplicateKey("notes/pricing.md", "we  decided to charge 29 EUR!"),
    );
    expect(duplicateKey("notes/other.md", "We decided to charge 29 EUR.")).not.toBe(
      duplicateKey("notes/pricing.md", "We decided to charge 29 EUR."),
    );
  });

  it("matches phrases configured in the workspace config", () => {
    const content = "# Setup\n\nFestgelegt: die Migration läuft im Oktober.\n";
    const config = parseConfig("config.json", JSON.stringify({ extraPhrases: ["festgelegt:"] }));

    expect(parseDecisions("notes/setup.md", content, { detectedAt })).toEqual([]);

    const found = parseDecisions("notes/setup.md", content, { detectedAt, config });
    expect(found).toHaveLength(1);
    expect(found[0]?.signals.phraseStrength).toBe("medium");
    expect(found[0]?.location).toBe("notes/setup.md#L3");
  });

  it("shortens long statements at a word boundary", () => {
    const long = `We decided ${"to review the pricing page again ".repeat(12)}today.`;

    const [decision] = parseDecisions("notes/long.md", long, { detectedAt });

    expect(decision?.statement.length).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH + 1);
    expect(decision?.statement.endsWith("…")).toBe(true);
  });
});

describe("isSupportedSource", () => {
  it("accepts the five input formats and nothing else", () => {
    for (const path of ["a.md", "a.markdown", "a.HTML", "a.htm", "notes/a.txt"]) {
      expect(isSupportedSource(path)).toBe(true);
    }
    for (const path of ["a.ts", "a.pdf", "a"]) {
      expect(isSupportedSource(path)).toBe(false);
    }
  });
});
