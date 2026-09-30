/**
 * spine.ts — the text spine.
 *
 * The spine is the shared timeline of the document. It splits text into
 * paragraphs, sentences and words, and records each unit's exact position
 * as character offsets into the original string.
 *
 * Analogy: if the lanes are tracks on a mixing desk, the spine is the
 * timecode. Every analyser pins its labels to these offsets, which is what
 * lets all the lanes line up.
 *
 * Offsets are UTF-16 code-unit indices (JavaScript's native string indices).
 * They match `textarea.selectionStart`, so a click in the editor maps
 * straight onto the spine. `text.slice(start, end) === unit.text` always holds.
 */

/** Anything with a position in the text. `end` is exclusive. */
export interface TextUnit {
  /** Position of this unit in its list (0-based, document order). */
  index: number;
  start: number;
  end: number;
  /** Exactly `spine.text.slice(start, end)`. */
  text: string;
}

export type Paragraph = TextUnit;

export interface Word extends TextUnit {
  /** Index of the sentence this word belongs to. */
  sentence: number;
}

export interface Sentence extends TextUnit {
  /** Index of the paragraph this sentence belongs to. */
  paragraph: number;
  /** The words in this sentence (also listed in `spine.words`). */
  words: Word[];
}

export interface Spine {
  text: string;
  paragraphs: Paragraph[];
  sentences: Sentence[];
  words: Word[];
}

/**
 * Abbreviations whose trailing period does NOT end a sentence.
 * Lower-case, without the final period. Words that often end sentences
 * ("etc", "no") are deliberately left out.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "cf", "al",
  "e.g", "i.e", "fig", "vol", "pp", "ed", "eds", "inc", "ltd", "approx",
  "dept", "mt",
]);

/** Sentence-ending punctuation (runs like "?!" or "..." are one ending). */
const TERMINATOR = /[.!?…]+/g;
/** Characters that close a sentence after its punctuation: quotes, brackets. */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "»"]);
/** Characters that may open the next sentence. */
const OPENERS = new Set(['"', "'", "“", "‘", "(", "[", "«"]);
/** A word: letters/marks/digits, joined by internal apostrophes or hyphens. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
/** One or more blank lines separate paragraphs. */
const PARAGRAPH_BREAK = /\n[ \t]*(?:\n[ \t]*)+/g;

/**
 * Build the spine for `text`.
 *
 * @example
 * const s = buildSpine("The cat sat. The dog ran.");
 * s.sentences[1].start; // 13
 */
export function buildSpine(text: string): Spine {
  const paragraphs = splitParagraphs(text);
  const sentences: Sentence[] = [];
  const words: Word[] = [];

  for (const para of paragraphs) {
    for (const [start, end] of splitSentences(text, para.start, para.end)) {
      const sentence: Sentence = {
        index: sentences.length,
        start,
        end,
        text: text.slice(start, end),
        paragraph: para.index,
        words: [],
      };
      for (const m of text.slice(start, end).matchAll(WORD)) {
        const wStart = start + m.index;
        const word: Word = {
          index: words.length,
          start: wStart,
          end: wStart + m[0].length,
          text: m[0],
          sentence: sentence.index,
        };
        sentence.words.push(word);
        words.push(word);
      }
      sentences.push(sentence);
    }
  }

  return { text, paragraphs, sentences, words };
}

/**
 * Find the sentence at a character offset (e.g. the editor caret).
 * A caret in the gap between two sentences belongs to the earlier one.
 */
export function sentenceAt(spine: Spine, offset: number): Sentence | undefined {
  let found: Sentence | undefined = spine.sentences[0];
  for (const s of spine.sentences) {
    if (s.start <= offset) found = s;
    else break;
  }
  return found;
}

/** Split into paragraphs on blank lines, trimming surrounding whitespace. */
function splitParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let segStart = 0;

  const addSegment = (from: number, to: number) => {
    const [start, end] = trimRange(text, from, to);
    if (start < end) {
      paragraphs.push({ index: paragraphs.length, start, end, text: text.slice(start, end) });
    }
  };

  for (const m of text.matchAll(PARAGRAPH_BREAK)) {
    addSegment(segStart, m.index);
    segStart = m.index + m[0].length;
  }
  addSegment(segStart, text.length);
  return paragraphs;
}

/**
 * Split the paragraph `text[from, to)` into sentence ranges.
 *
 * A punctuation run ends a sentence when all of these hold:
 *   1. it is followed (after any closing quotes/brackets) by whitespace or the paragraph end;
 *   2. the next sentence starts with a capital, a digit or an opening quote/bracket;
 *   3. it is not the period of an abbreviation ("Dr.") or an initial ("J.").
 */
function splitSentences(text: string, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const para = text.slice(from, to);
  let sentStart = 0; // relative to the paragraph

  for (const m of para.matchAll(TERMINATOR)) {
    // Extend the ending over closing quotes/brackets: `Stop!”` ends after the quote.
    let end = m.index + m[0].length;
    while (end < para.length && CLOSERS.has(para[end]!)) end++;

    if (end < para.length && !/\s/.test(para[end]!)) continue; // rule 1: "3.14", "e.g"

    if (end < para.length) {
      const next = para.slice(end).trimStart()[0] ?? "";
      const startsSentence = /[\p{Lu}\p{N}]/u.test(next) || OPENERS.has(next);
      if (!startsSentence) continue; // rule 2: "Wait... what"
    }

    if (m[0] === "." && isAbbreviation(para.slice(0, m.index))) continue; // rule 3

    ranges.push([from + sentStart, from + end]);
    sentStart = end + (para.slice(end).length - para.slice(end).trimStart().length);
  }

  // Whatever is left (e.g. a last sentence without punctuation).
  if (sentStart < para.length) {
    const [start, end] = trimRange(text, from + sentStart, to);
    if (start < end) ranges.push([start, end]);
  }
  return ranges;
}

/** Does the text before a period end with an abbreviation or a single initial? */
function isAbbreviation(before: string): boolean {
  const token = /[\p{L}.]+$/u.exec(before)?.[0];
  if (!token) return false;
  if (ABBREVIATIONS.has(token.toLowerCase())) return true;
  // Initials: "J." or the last letter of "U.S." — a single capital letter.
  const lastPart = token.split(".").pop() ?? "";
  return /^\p{Lu}$/u.test(lastPart);
}

/** Shrink [from, to) past leading and trailing whitespace. */
function trimRange(text: string, from: number, to: number): [number, number] {
  while (from < to && /\s/.test(text[from]!)) from++;
  while (to > from && /\s/.test(text[to - 1]!)) to--;
  return [from, to];
}
