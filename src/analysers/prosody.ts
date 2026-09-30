/**
 * prosody.ts — the Prosody lane.
 *
 * Reads the sound of the prose: where the stresses fall, how sentences land,
 * and repeated sounds. Stress comes from a pronouncing dictionary (the CMU
 * dictionary in the app). Think of it as reading the text's drum track.
 *
 * Labels:
 *   - rhythm            one span per sentence. Its note spells the stress pattern
 *                       word by word (x = unstressed, / = stressed, \ = secondary,
 *                       ? = unknown). Score = stress density, rescaled so 25%
 *                       stressed → 0 and 75% → 1: dark cells are heavy and
 *                       emphatic, pale cells light and quick.
 *   - weak-ending       the sentence ends on a function word ("…noticed it.")
 *                       or on two unstressed syllables ("…beautifully.")
 *   - alliteration      2+ content words, at most one word apart, starting with
 *                       the same consonant *sound* ("phone"/"fish", not "cat"/"city")
 *   - ambiguous-stress  the dictionary gives stress patterns that differ by
 *                       meaning ("reCORD" vs "REcord")
 *   - uncertain         word not in the dictionary: syllables are guessed and
 *                       its stress is left out of the score
 *
 * The analyser takes a `Pronouncer` rather than importing the dictionary, so
 * tests can pass a tiny one and the app can load the big one lazily.
 */
import { syllable } from "syllable";
import type { Sentence, Spine, Word } from "../spine";
import type { Analyser, Span } from "./types";
import { isStopword } from "./lexicon";

const LAYER = "prosody";

/** Stress share mapped to score 0 … */
const DENSITY_LOW = 0.25;
/** … and to score 1. */
const DENSITY_HIGH = 0.75;
/** Max word positions between two alliterating words (2 = one word between). */
const ALLITERATION_GAP = 2;

/** Returns every known pronunciation of a word (each a list of phonemes), or []. */
export type Pronouncer = (word: string) => string[][];

/**
 * Build a Pronouncer from a CMU-style dictionary: `{ word: "PH ON EMES" }`,
 * with alternative pronunciations under "word(2)", "word(3)", …
 */
export function cmuPronouncer(dict: Record<string, string>): Pronouncer {
  const all = (key: string): string[][] => {
    const out: string[][] = [];
    for (let i = 1; ; i++) {
      const entry = dict[i === 1 ? key : `${key}(${i})`];
      if (entry === undefined) break;
      out.push(entry.split(" "));
    }
    return out;
  };

  return (word) => {
    const key = word.toLowerCase().replace(/’/g, "'");
    const found = all(key);
    if (found.length) return found;
    // "Peter's" → "peter": possessives are rarely listed.
    return key.endsWith("'s") ? all(key.slice(0, -2)) : [];
  };
}

/**
 * Stress marks for one pronunciation: one character per syllable.
 * CMU marks each vowel with a digit: 1 → "/", 2 → "\", 0 → "x".
 * @example stressOf(["N","OW1","B","AA2","D","IY0"]) // "/\\x"
 */
export function stressOf(phonemes: string[]): string {
  return phonemes
    .map((p) => p.at(-1))
    .filter((d) => d === "0" || d === "1" || d === "2")
    .map((d) => (d === "1" ? "/" : d === "2" ? "\\" : "x"))
    .join("");
}

/** What the lane knows about one word's sound. */
interface WordSound {
  word: Word;
  /** Stress marks, one per syllable ("?" when unknown). */
  stress: string;
  /** First phoneme if it is a consonant (e.g. "F"), else undefined. */
  onset: string | undefined;
  known: boolean;
  /** True when alternative pronunciations stress different syllables. */
  ambiguous: boolean;
}

/** Create the Prosody analyser around a pronouncing dictionary. */
export function createProsodyAnalyser(pronounce: Pronouncer): Analyser {
  /** Look one word up and summarise its sound. */
  const soundOf = (word: Word): WordSound => {
    const prons = pronounce(word.text);
    if (prons.length === 0) {
      // Unknown: guess the syllable count, leave the stress unknown.
      const n = Math.max(1, syllable(word.text));
      const first = word.text[0]?.toUpperCase() ?? "";
      return { word, stress: "?".repeat(n), onset: /[B-DF-HJ-NP-TV-Z]/.test(first) ? first : undefined, known: false, ambiguous: false };
    }
    const main = prons[0]!;
    let stress = stressOf(main);
    // One-syllable function words are unstressed in running speech ("the", "was").
    if (stress.length === 1 && isStopword(word.text)) stress = "x";
    const first = main[0]!;
    const patterns = new Set(prons.map(stressOf));
    return {
      word,
      stress,
      onset: /\d$/.test(first) ? undefined : first, // vowels carry a stress digit
      known: true,
      ambiguous: patterns.size > 1 && stress.length > 1,
    };
  };

  return {
    id: LAYER,
    name: "Prosody",
    description: "Stress and rhythm, weak endings, alliteration.",

    analyse(spine: Spine): Span[] {
      const spans: Span[] = [];
      for (const sentence of spine.sentences) {
        const sounds = sentence.words.map(soundOf);
        spans.push(rhythmSpan(sentence, sounds));
        spans.push(...weakEndingSpans(sounds));
        spans.push(...alliterationSpans(sounds));
        for (const s of sounds) {
          if (!s.known) spans.push(wordSpan(s.word, "uncertain", `“${s.word.text}” isn't in the dictionary; stress unknown`));
          if (s.ambiguous) spans.push(wordSpan(s.word, "ambiguous-stress", `Stress of “${s.word.text}” depends on its meaning`));
        }
      }
      return spans.sort((a, b) => a.start - b.start);
    },
  };
}

/** The sentence's stress pattern and density score. */
function rhythmSpan(sentence: Sentence, sounds: WordSound[]): Span {
  const marks = sounds.map((s) => s.stress).join("");
  const known = [...marks].filter((m) => m !== "?");
  const weight = known.reduce((sum, m) => sum + (m === "/" ? 1 : m === "\\" ? 0.5 : 0), 0);
  const share = known.length ? weight / known.length : 0;
  const score = known.length ? clamp((share - DENSITY_LOW) / (DENSITY_HIGH - DENSITY_LOW)) : 0;

  return {
    start: sentence.start,
    end: sentence.end,
    layer: LAYER,
    label: "rhythm",
    score,
    note: `${marks.length} syllables · ${Math.round(share * 100)}% stressed · ${sounds.map((s) => s.stress).join(" ")}`,
  };
}

/** Flag the last word if the sentence lands on a function word or two unstressed beats. */
function weakEndingSpans(sounds: WordSound[]): Span[] {
  const last = sounds.at(-1);
  if (!last) return [];
  if (isStopword(last.word.text)) {
    return [wordSpan(last.word, "weak-ending", "Ends on a function word; the sentence trails off")];
  }
  const tail = sounds.map((s) => s.stress).join("").slice(-2);
  if (tail === "xx") {
    return [wordSpan(last.word, "weak-ending", "Ends on two unstressed syllables; a falling close")];
  }
  return [];
}

/** Group nearby content words that share a starting consonant sound. */
function alliterationSpans(sounds: WordSound[]): Span[] {
  const spans: Span[] = [];
  const content = sounds.filter((s) => s.onset !== undefined && !isStopword(s.word.text));

  let group: WordSound[] = [];
  const flush = () => {
    if (group.length >= 2) {
      const first = group[0]!.word;
      const last = group.at(-1)!.word;
      spans.push({
        start: first.start,
        end: last.end,
        layer: LAYER,
        label: "alliteration",
        note: `Alliteration on /${group[0]!.onset!.toLowerCase()}/: ${group.map((g) => g.word.text).join(", ")}`,
      });
    }
  };

  for (const s of content) {
    const prev = group.at(-1);
    const joins = prev && prev.onset === s.onset && s.word.index - prev.word.index <= ALLITERATION_GAP;
    if (joins) {
      group.push(s);
    } else {
      flush();
      group = [s];
    }
  }
  flush();
  return spans;
}

/** Span over exactly one word. */
function wordSpan(w: Word, label: string, note: string): Span {
  return { start: w.start, end: w.end, layer: LAYER, label, note };
}

/** Clamp to 0–1. */
function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}
