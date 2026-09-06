import { extname } from "node:path";

/** File types the parser reads. Everything else is ignored by the watcher. */
export const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".html", ".htm", ".txt"] as const;

export function isSupportedSource(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * A file reduced to readable text. `lines` stays 1:1 with the source file —
 * index 0 is line 1 — so every reported line number is a line of the file the
 * user can open, even for HTML where the markup was stripped away.
 */
export interface SourceText {
  readonly lines: readonly string[];
  /** 1-based line numbers that carry a heading (Markdown `#` or HTML `<h1>`). */
  readonly headingLines: ReadonlySet<number>;
}

/** A sentence with the exact 1-based source lines it spans. */
export interface Sentence {
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** Chooses the reader by file extension; anything unknown is read as plain text. */
export function extractSourceText(path: string, content: string): SourceText {
  const extension = extname(path).toLowerCase();
  const lines = splitLines(content);
  return extension === ".html" || extension === ".htm"
    ? extractHtmlText(lines)
    : extractMarkdownText(lines);
}

function splitLines(content: string): readonly string[] {
  return content.replace(/^﻿/, "").split(/\r\n|\n|\r/);
}

/**
 * Markdown and plain text are already readable. Fenced code blocks are blanked
 * out — sample code is not a decision — and setext underlines are dropped so
 * they do not end up inside a sentence.
 */
function extractMarkdownText(lines: readonly string[]): SourceText {
  const headingLines = new Set<number>();
  const out: string[] = [];
  let fence: string | undefined;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const fenceMarker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (fence !== undefined) {
      out.push("");
      if (fenceMarker === fence) {
        fence = undefined;
      }
      continue;
    }
    if (fenceMarker !== undefined) {
      fence = fenceMarker;
      out.push("");
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+\S/.test(line)) {
      headingLines.add(lineNumber);
    }
    if (/^\s{0,3}(=+|-{2,})\s*$/.test(line) && (lines[index - 1] ?? "").trim() !== "") {
      headingLines.add(lineNumber - 1);
      out.push("");
      continue;
    }
    out.push(line);
  }

  return { lines: out, headingLines };
}

/**
 * Strips markup while keeping the line count: every newline of the source is
 * kept, tags and the contents of `script`/`style`/comments become a space. That
 * way `#L42-L58` still points at the same lines in the original HTML file.
 */
function extractHtmlText(lines: readonly string[]): SourceText {
  const html = lines.join("\n");
  const headingLines = new Set<number>();
  const out: string[] = [];
  let current = "";
  let line = 1;
  let index = 0;

  const skipTo = (end: number): void => {
    for (const character of html.slice(index, end)) {
      if (character === "\n") {
        out.push(current);
        current = "";
        line += 1;
      }
    }
    index = end;
  };

  while (index < html.length) {
    const character = html[index] as string;
    if (character === "\n") {
      out.push(current);
      current = "";
      line += 1;
      index += 1;
      continue;
    }
    if (character !== "<") {
      current += character;
      index += 1;
      continue;
    }

    const rest = html.slice(index);
    if (rest.startsWith("<!--")) {
      skipTo(endOf(html, index, "-->", 3));
      current += " ";
      continue;
    }
    const hidden = /^<(script|style)\b/i.exec(rest)?.[1];
    if (hidden !== undefined) {
      const close = html.toLowerCase().indexOf(`</${hidden}`, index);
      skipTo(close === -1 ? html.length : endOf(html, close, ">", 1));
      current += " ";
      continue;
    }
    if (/^<h[1-6][\s>]/i.test(rest)) {
      headingLines.add(line);
    }
    skipTo(endOf(html, index, ">", 1));
    current += " ";
  }
  out.push(current);

  return { lines: out.map(decodeEntities), headingLines };
}

/** The index just past `marker`, or the end of the file for unclosed markup. */
function endOf(html: string, from: number, marker: string, length: number): number {
  const found = html.indexOf(marker, from + 1);
  return found === -1 ? html.length : found + length;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(line: string): string {
  return line.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Splits readable text into sentences that know their source lines. Blocks are
 * runs of non-empty lines; a heading, a list item or a quote always starts a new
 * one, so a bullet list yields one statement per bullet.
 */
export function sentencesOf(source: SourceText): readonly Sentence[] {
  const sentences: Sentence[] = [];
  let block: { lines: string[]; startLine: number } | undefined;

  const flush = (): void => {
    if (block !== undefined) {
      sentences.push(...splitBlock(block.lines, block.startLine));
      block = undefined;
    }
  };

  for (const [index, line] of source.lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (block === undefined || startsBlock(line) || source.headingLines.has(lineNumber)) {
      flush();
      block = { lines: [], startLine: lineNumber };
    }
    block.lines.push(line);
  }
  flush();

  return sentences;
}

function startsBlock(line: string): boolean {
  return /^\s*([-*+]\s+|\d+[.)]\s+|>|#{1,6}\s+|\|)/.test(line);
}

/** Abbreviations whose dot must not end a sentence. */
const ABBREVIATIONS = new Set([
  "z",
  "b",
  "bzw",
  "ca",
  "ggf",
  "usw",
  "evtl",
  "inkl",
  "nr",
  "e",
  "g",
  "i",
  "vs",
  "mr",
  "mrs",
  "dr",
  "prof",
  "st",
  "no",
]);

function splitBlock(lines: readonly string[], startLine: number): readonly Sentence[] {
  const pieces = lines.map((line) => line.trim());
  const text = pieces.join(" ");

  // Offset of every line inside `text`, so a character index maps back to a line.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const piece of pieces) {
    lineStarts.push(offset);
    offset += piece.length + 1;
  }

  const lineAt = (position: number): number => {
    let found = 0;
    for (const [index, start] of lineStarts.entries()) {
      if (start <= position) {
        found = index;
      }
    }
    return startLine + found;
  };

  const sentences: Sentence[] = [];
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!isSentenceEnd(text, index)) {
      continue;
    }
    push(sentences, text, from, index + 1, lineAt);
    from = index + 1;
  }
  push(sentences, text, from, text.length, lineAt);

  return sentences;
}

function push(
  sentences: Sentence[],
  text: string,
  from: number,
  to: number,
  lineAt: (position: number) => number,
): void {
  let start = from;
  while (start < to && /\s/.test(text[start] as string)) {
    start += 1;
  }
  let end = to;
  while (end > start && /\s/.test(text[end - 1] as string)) {
    end -= 1;
  }
  if (start >= end) {
    return;
  }
  sentences.push({
    text: text.slice(start, end),
    startLine: lineAt(start),
    endLine: lineAt(end - 1),
  });
}

/** A `.`, `!` or `?` ends a sentence unless it belongs to a number or an abbreviation. */
function isSentenceEnd(text: string, index: number): boolean {
  const character = text[index];
  if (character !== "." && character !== "!" && character !== "?") {
    return false;
  }
  const next = text[index + 1];
  if (next !== undefined && !/\s/.test(next)) {
    return false;
  }
  if (character === ".") {
    const word = /([\p{L}\p{N}]+)\.$/u.exec(text.slice(0, index + 1))?.[1] ?? "";
    if (/^\p{N}+$/u.test(word) || ABBREVIATIONS.has(word.toLowerCase())) {
      return false;
    }
  }
  return true;
}
