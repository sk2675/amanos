/**
 * Words that describe the act of deciding, rather than the subject of a
 * decision. Keeping this list in one place makes replacement detection and
 * impact scanning use the same, explainable vocabulary.
 */
const STOP_WORDS = new Set([
  // English function words and decision boilerplate.
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "before",
  "been",
  "being",
  "by",
  "decide",
  "decided",
  "decides",
  "deciding",
  "decision",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "now",
  "of",
  "on",
  "or",
  "our",
  "should",
  "that",
  "the",
  "their",
  "this",
  "to",
  "use",
  "used",
  "uses",
  "using",
  "we",
  "will",
  "with",
  // German function words and decision boilerplate.
  "ab",
  "aber",
  "als",
  "auf",
  "aus",
  "bei",
  "beschlossen",
  "beschliessen",
  "beschließen",
  "bis",
  "das",
  "dass",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "durch",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "entscheiden",
  "entscheidet",
  "entscheidung",
  "entschieden",
  "für",
  "fur",
  "haben",
  "hat",
  "im",
  "in",
  "ist",
  "jetzt",
  "mit",
  "oder",
  "setzen",
  "sich",
  "sind",
  "und",
  "uns",
  "uber",
  "vom",
  "von",
  "wir",
  "wird",
  "werden",
  "zu",
  "zum",
  "zur",
  // Broad project vocabulary creates noisy cross-topic links.
  "app",
  "application",
  "code",
  "datei",
  "data",
  "feature",
  "file",
  "project",
  "projekt",
  "service",
  "system",
  "team",
  "user",
  "version",
  "website",
]);

export interface TopicReference {
  readonly title: string;
  readonly source: string | undefined;
}

/**
 * Extracts stable, lower-case search terms. CamelCase is split before
 * normalisation so `stripePriceId` can match `Stripe` and `price`.
 */
export function deriveKeywords(value: string): readonly string[] {
  const words = wordsOf(value);
  return [...new Set(words.filter(isKeyword))].sort();
}

/** Returns the deterministic strength of a possible replacement relation. */
export function replacementSimilarity(current: TopicReference, previous: TopicReference): number {
  const currentKeywords = new Set(deriveKeywords(current.title));
  const shared = deriveKeywords(previous.title).filter((keyword) => currentKeywords.has(keyword));
  if (shared.length === 0) return 0;

  const currentSource = parseSource(current.source);
  const previousSource = parseSource(previous.source);
  const sameFile =
    currentSource !== undefined &&
    previousSource !== undefined &&
    currentSource.path === previousSource.path;
  const sameSection = sameFile && sourcesShareSection(currentSource, previousSource);
  const significant = shared.filter(
    (keyword) => /^\d+$/.test(keyword) || keyword.length >= 5,
  ).length;

  // One short term such as `pro` is only enough with source context. Across
  // files, require either a longer topic word or at least two shared terms.
  if (significant === 0 && shared.length < 2 && !sameFile) return 0;

  return significant * 20 + shared.length * 5 + (sameFile ? 3 : 0) + (sameSection ? 5 : 0);
}

/** Tokenises source text and paths using the same rules as decision titles. */
export function wordsOf(value: string): readonly string[] {
  const separated = value
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return separated.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isKeyword(word: string): boolean {
  if (STOP_WORDS.has(word)) return false;
  if (/^\d+$/.test(word)) return true;
  return word.length >= 3;
}

interface ParsedSource {
  readonly path: string;
  readonly startLine: number | undefined;
  readonly endLine: number | undefined;
  readonly section: string | undefined;
}

function parseSource(source: string | undefined): ParsedSource | undefined {
  if (source === undefined) return undefined;
  const line = /^(.*)#L(\d+)(?:-L(\d+))?$/.exec(source);
  if (line !== null) {
    const startLine = Number.parseInt(line[2] as string, 10);
    return {
      path: line[1] as string,
      startLine,
      endLine: Number.parseInt(line[3] ?? String(startLine), 10),
      section: undefined,
    };
  }
  const anchor = /^(.*)#([^#]+)$/.exec(source);
  return anchor === null
    ? { path: source, startLine: undefined, endLine: undefined, section: undefined }
    : {
        path: anchor[1] as string,
        startLine: undefined,
        endLine: undefined,
        section: (anchor[2] as string).toLowerCase(),
      };
}

function sourcesShareSection(left: ParsedSource, right: ParsedSource): boolean {
  if (left.section !== undefined || right.section !== undefined) {
    return left.section !== undefined && left.section === right.section;
  }
  if (
    left.startLine === undefined ||
    left.endLine === undefined ||
    right.startLine === undefined ||
    right.endLine === undefined
  ) {
    return false;
  }
  const distance = Math.max(left.startLine, right.startLine) - Math.min(left.endLine, right.endLine);
  return distance <= 25;
}
