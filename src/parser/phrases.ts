import type { WorkspaceConfig } from "../workspace/config.js";

/**
 * How much a phrase is worth as evidence. `strong` phrases name a decision
 * outright ("we decided"), `weak` ones only announce a change of practice
 * ("from now on") and are often used for plans that were never decided.
 */
export type PhraseStrength = "strong" | "medium" | "weak";

export interface DecisionPhrase {
  /** Matched case-insensitively, on word boundaries. */
  readonly text: string;
  readonly strength: PhraseStrength;
}

/** The built-in DE/EN list. Users add to it, they never have to replace it. */
export const DEFAULT_PHRASES: readonly DecisionPhrase[] = [
  { text: "wir entscheiden", strength: "strong" },
  { text: "wir haben entschieden", strength: "strong" },
  { text: "entschieden", strength: "medium" },
  { text: "beschlossen", strength: "strong" },
  { text: "ab jetzt", strength: "weak" },
  { text: "wir setzen auf", strength: "strong" },
  { text: "we will", strength: "weak" },
  { text: "we decided", strength: "strong" },
  { text: "we have decided", strength: "strong" },
  { text: "decision:", strength: "strong" },
  { text: "from now on", strength: "weak" },
];

/** Phrases configured by the user count as `medium`: real, but not verbatim. */
export const CONFIGURED_PHRASE_STRENGTH: PhraseStrength = "medium";

/**
 * The built-in list plus `extraPhrases` from the config. Duplicates keep the
 * built-in strength, so a user cannot accidentally weaken a known phrase.
 */
export function resolvePhrases(config?: WorkspaceConfig): readonly DecisionPhrase[] {
  const extra = config?.extraPhrases ?? [];
  const known = new Set(DEFAULT_PHRASES.map((phrase) => phrase.text.toLowerCase()));
  const added: DecisionPhrase[] = [];

  for (const text of extra) {
    const normalised = text.trim();
    if (normalised === "" || known.has(normalised.toLowerCase())) {
      continue;
    }
    known.add(normalised.toLowerCase());
    added.push({ text: normalised, strength: CONFIGURED_PHRASE_STRENGTH });
  }

  return added.length === 0 ? DEFAULT_PHRASES : [...DEFAULT_PHRASES, ...added];
}

/**
 * The phrase that best explains a statement, or undefined if none matches.
 * Ties are resolved deterministically: strongest first, then the longest
 * phrase text, then alphabetically — so the result never depends on list order.
 */
export function findPhrase(
  statement: string,
  phrases: readonly DecisionPhrase[],
): DecisionPhrase | undefined {
  let best: DecisionPhrase | undefined;
  for (const phrase of phrases) {
    if (!matcherFor(phrase.text).test(statement)) {
      continue;
    }
    if (best === undefined || comparePhrases(phrase, best) < 0) {
      best = phrase;
    }
  }
  return best;
}

const STRENGTH_ORDER: Record<PhraseStrength, number> = { strong: 0, medium: 1, weak: 2 };

function comparePhrases(a: DecisionPhrase, b: DecisionPhrase): number {
  return (
    STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] ||
    b.text.length - a.text.length ||
    (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
  );
}

const matchers = new Map<string, RegExp>();

/**
 * Word boundaries are only added where the phrase itself has a letter or digit
 * at that end, so "decision:" still matches but "we will" does not fire inside
 * "we willingly".
 */
function matcherFor(text: string): RegExp {
  const cached = matchers.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const body = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const start = /[\p{L}\p{N}]/u.test(text.at(0) ?? "") ? "(?<![\\p{L}\\p{N}])" : "";
  const end = /[\p{L}\p{N}]/u.test(text.at(-1) ?? "") ? "(?![\\p{L}\\p{N}])" : "";
  const matcher = new RegExp(`${start}${body}${end}`, "iu");
  matchers.set(text, matcher);
  return matcher;
}
