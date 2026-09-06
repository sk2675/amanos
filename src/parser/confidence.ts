import type { DecisionPhrase, PhraseStrength } from "./phrases.js";

/** The individual points a confidence is made of, kept for explanations. */
export interface ConfidenceSignals {
  /** The phrase that triggered the finding, as configured. */
  readonly phrase: string;
  readonly phraseStrength: PhraseStrength;
  readonly phrasePoints: number;
  readonly headingPoints: number;
  readonly numberPoints: number;
  readonly properNounPoints: number;
  readonly detailPoints: number;
}

/** Points per phrase strength; see `scoreConfidence` for the whole rule. */
export const PHRASE_POINTS: Record<PhraseStrength, number> = {
  strong: 50,
  medium: 38,
  weak: 26,
};

const NEAR_HEADING_LINES = 3;
const UNDER_HEADING_LINES = 10;
const NEAR_HEADING_POINTS = 18;
const UNDER_HEADING_POINTS = 9;
const NUMBER_POINTS = 12;
const PROPER_NOUN_POINTS = 10;
const DETAIL_POINTS = 6;
const DETAIL_WORDS = 6;

/**
 * The confidence rule. It is a fixed sum of five signals, so the same statement
 * always scores the same number and a reader can predict it:
 *
 * ```text
 * phrase strength   strong 50 | medium 38 | weak 26
 * + heading         18 if the statement starts within 3 lines below the nearest
 *                   heading above it, 9 within 10 lines, otherwise 0
 * + number          12 if the statement contains a digit (price, date, count)
 * + proper noun     10 if it contains an acronym (AWS) or an inner-capital name
 *                   (PostgreSQL) — plain capitalisation says nothing in German
 * + detail          6 if the statement has at least 6 words
 * ```
 *
 * The result is clamped to 0..100; in practice it ranges from 26 ("we will",
 * buried in a paragraph, no specifics) to 96 (a concrete "we decided" right
 * under its heading). With the default `draftBelowConfidence` of 70 a weak
 * phrase alone can never activate a decision.
 */
export function scoreConfidence(
  statement: string,
  phrase: DecisionPhrase,
  startLine: number,
  headingLines: ReadonlySet<number>,
): { readonly confidence: number; readonly signals: ConfidenceSignals } {
  const signals: ConfidenceSignals = {
    phrase: phrase.text,
    phraseStrength: phrase.strength,
    phrasePoints: PHRASE_POINTS[phrase.strength],
    headingPoints: headingPoints(startLine, headingLines),
    numberPoints: /\p{Nd}/u.test(statement) ? NUMBER_POINTS : 0,
    properNounPoints: hasProperNoun(statement) ? PROPER_NOUN_POINTS : 0,
    detailPoints: wordCount(statement) >= DETAIL_WORDS ? DETAIL_POINTS : 0,
  };

  const total =
    signals.phrasePoints +
    signals.headingPoints +
    signals.numberPoints +
    signals.properNounPoints +
    signals.detailPoints;

  return { confidence: Math.max(0, Math.min(100, total)), signals };
}

function headingPoints(startLine: number, headingLines: ReadonlySet<number>): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const heading of headingLines) {
    if (heading <= startLine) {
      distance = Math.min(distance, startLine - heading);
    }
  }
  if (distance <= NEAR_HEADING_LINES) return NEAR_HEADING_POINTS;
  if (distance <= UNDER_HEADING_LINES) return UNDER_HEADING_POINTS;
  return 0;
}

/**
 * A brand or acronym: `AWS`, `PostgreSQL`, `GmbH`. Deliberately not "starts
 * with a capital" — every German noun does, which would make the signal noise.
 */
function hasProperNoun(statement: string): boolean {
  // An uppercase letter anywhere but the first character: AW[S], Postgre[SQL].
  return /[\p{L}\p{Nd}][\p{L}\p{Nd}]*\p{Lu}/u.test(statement);
}

function wordCount(statement: string): number {
  return statement.split(/\s+/).filter((word) => /[\p{L}\p{Nd}]/u.test(word)).length;
}
