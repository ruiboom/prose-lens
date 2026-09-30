/**
 * diction.ts — the Diction lane.
 *
 * Looks at word choice:
 *   - latinate    words with Latinate suffixes ("facilitate", "implementation");
 *                 a rough proxy for formal, abstract register
 *   - long-word   words of 12+ letters
 *   - repetition  a content word used again within 30 words
 *   - cliche      stock phrases from a small list ("at the end of the day")
 *   - density     one span per sentence; score = share of its words flagged
 *                 by the word-level labels above, reaching 1 at 30% flagged
 *                 (raw shares are small, so unscaled shading looks empty).
 *                 Drives the lane's shading.
 *
 * Suffix rules are a heuristic: "native" (Latin) is caught, "wisdom" (Old
 * English) is not, but "promise" (Latin) is caught for the wrong reason.
 */
import type { Spine, Word } from "../spine";
import type { Analyser, Span } from "./types";
import { STOPWORDS } from "./lexicon";

const LAYER = "diction";

/** Suffixes typical of words borrowed from Latin (often via French). */
const LATINATE_SUFFIX = /(tion|sion|ity|ous|ive|ate|ment|ance|ence|ancy|ency|ible|able|ial|ular|ize|ise|ify)$/;
/** Shorter words with those endings are mostly native ("late", "give"). */
const LATINATE_MIN_LENGTH = 7;
/** Letters at which a word counts as long. */
const LONG_WORD_LETTERS = 12;
/** How many words back to look for a repeat. */
const REPETITION_WINDOW = 30;
/** Content words shorter than this are not checked for repetition. */
const REPETITION_MIN_LENGTH = 4;
/** Share of flagged words at which a sentence counts as fully dense (score 1). */
const DENSITY_FULL = 0.3;

/** Stock phrases. Spaces match any run of whitespace, so line breaks don't hide them. */
const CLICHES = [
  "at the end of the day", "in this day and age", "think outside the box",
  "low-hanging fruit", "last but not least", "few and far between",
  "the fact of the matter", "needless to say", "all things considered",
  "moving forward", "going forward", "par for the course", "tip of the iceberg",
  "perfect storm", "the bottom line", "in the nick of time", "time will tell",
  "avoid like the plague", "better late than never", "at this point in time",
  "each and every", "first and foremost", "in a nutshell", "game changer",
  "paradigm shift", "it goes without saying", "when all is said and done",
];

/** One case-insensitive regex for all clichés, whole words only. */
const CLICHE_PATTERN = new RegExp(
  `\\b(?:${CLICHES.map((c) => c.split(" ").map(escapeRegExp).join("\\s+")).join("|")})\\b`,
  "gi",
);

export const dictionAnalyser: Analyser = {
  id: LAYER,
  name: "Diction",
  description: "Latinate and long words, nearby repetition, clichés.",

  analyse(spine: Spine): Span[] {
    const wordSpans = [
      ...spine.words.filter(isLatinate).map((w) => wordSpan(w, "latinate", "Latinate word: often more formal or abstract")),
      ...spine.words.filter((w) => w.text.length >= LONG_WORD_LETTERS).map((w) => wordSpan(w, "long-word", `${w.text.length} letters`)),
      ...repetitionSpans(spine.words),
    ];
    const spans = [...wordSpans, ...clicheSpans(spine.text), ...densitySpans(spine, wordSpans)];
    return spans.sort((a, b) => a.start - b.start);
  },
};

/** Does the word end in a Latinate suffix (and is long enough to trust it)? */
function isLatinate(w: Word): boolean {
  const lower = w.text.toLowerCase();
  return lower.length >= LATINATE_MIN_LENGTH && LATINATE_SUFFIX.test(lower);
}

/** Build a span covering exactly one word. */
function wordSpan(w: Word, label: string, note: string): Span {
  return { start: w.start, end: w.end, layer: LAYER, label, note };
}

/** Flag later uses of a content word seen within the last REPETITION_WINDOW words. */
function repetitionSpans(words: Word[]): Span[] {
  const lastSeen = new Map<string, number>(); // word (lower-case) → last word index
  const spans: Span[] = [];

  for (const w of words) {
    const key = w.text.toLowerCase();
    if (key.length < REPETITION_MIN_LENGTH || STOPWORDS.has(key)) continue;

    const prev = lastSeen.get(key);
    if (prev !== undefined && w.index - prev <= REPETITION_WINDOW) {
      spans.push(wordSpan(w, "repetition", `Also used ${w.index - prev} words earlier`));
    }
    lastSeen.set(key, w.index);
  }
  return spans;
}

/** Find cliché phrases anywhere in the text. */
function clicheSpans(text: string): Span[] {
  return [...text.matchAll(CLICHE_PATTERN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    layer: LAYER,
    label: "cliche",
    note: `Cliché: “${m[0].replace(/\s+/g, " ")}”`,
  }));
}

/** Per sentence: the share of its words flagged by any word-level label. */
function densitySpans(spine: Spine, wordSpans: Span[]): Span[] {
  const flaggedStarts = new Set(wordSpans.map((s) => s.start));
  return spine.sentences.map((s) => {
    const flagged = s.words.filter((w) => flaggedStarts.has(w.start)).length;
    return {
      start: s.start,
      end: s.end,
      layer: LAYER,
      label: "density",
      score: s.words.length ? Math.min(flagged / s.words.length / DENSITY_FULL, 1) : 0,
      note: `${flagged} of ${s.words.length} words flagged`,
    };
  });
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
