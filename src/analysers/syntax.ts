/**
 * syntax.ts — the Syntax lane.
 *
 * Looks at how sentences are built, using fast rule-based heuristics:
 *   - length          one span per sentence; score = words / 40 (capped at 1),
 *                     so the lane shading shows long sentences at a glance
 *   - monotone        three or more sentences in a row of near-identical length
 *                     (rhythm that drones, like a metronome)
 *   - passive         a form of "to be" + past participle ("was kicked")
 *   - nominalisation  a verb turned into a noun ("decide" → "decision")
 *
 * These are heuristics, not a parser: expect some false positives
 * (e.g. "She was tired" reads as passive only if "tired" is not in the
 * adjective list). The README lists known blind spots.
 */
import type { Sentence, Spine } from "../spine";
import type { Analyser, Span } from "./types";

const LAYER = "syntax";

/** Words per sentence that count as "fully long" (score 1). */
const LONG_SENTENCE_WORDS = 40;
/** Minimum run of similar-length sentences to flag as monotone. */
const MONOTONE_MIN_RUN = 3;
/** Max spread in word count (longest − shortest) within a monotone run. */
const MONOTONE_SPREAD = 2;

/** Forms of "to be" that start a passive construction. */
const BE_FORMS = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);

/** Common irregular past participles (regular ones end in "-ed"). */
const IRREGULAR_PARTICIPLES = new Set([
  "bought", "brought", "built", "caught", "chosen", "done", "driven", "eaten",
  "fed", "felt", "forgotten", "found", "given", "held", "heard", "hidden",
  "hit", "hung", "kept", "known", "laid", "led", "left", "lost", "made",
  "meant", "met", "paid", "put", "read", "said", "seen", "sent", "set",
  "shown", "shut", "sold", "spent", "spoken", "stolen", "taken", "taught",
  "thought", "told", "understood", "won", "written", "broken", "frozen",
  "given", "grown", "thrown", "worn", "born", "begun", "sung", "drawn",
]);

/** "-ed" words that usually act as adjectives after "to be" ("She was tired"). */
const ED_ADJECTIVES = new Set([
  "tired", "bored", "excited", "interested", "pleased", "married", "worried",
  "concerned", "scared", "surprised", "confused", "annoyed", "ashamed",
  "embarrassed", "relaxed", "stressed", "red", "bed", "shed", "need",
]);

/** Suffixes that usually mark a nominalisation. */
const NOMINAL_SUFFIX = /(tion|sion|ment|ness|ity|ance|ence|ism)$/;
/** Words with those suffixes that are not verbs-turned-nouns. */
const NOMINAL_STOPLIST = new Set([
  "station", "nation", "question", "mention", "moment", "comment", "element",
  "cement", "apartment", "business", "witness", "city", "university",
  "community", "science", "evidence", "audience", "distance", "balance",
  "instance", "sentence", "fitness", "chance", "tourism", "garment",
]);
/** Shorter words are rarely nominalisations ("city", "ness"). */
const NOMINAL_MIN_LENGTH = 7;

export const syntaxAnalyser: Analyser = {
  id: LAYER,
  name: "Syntax",
  description: "Sentence length and rhythm, passive voice and nominalisations.",

  analyse(spine: Spine): Span[] {
    const spans: Span[] = [
      ...lengthSpans(spine.sentences),
      ...monotoneSpans(spine.sentences),
      ...spine.sentences.flatMap(passiveSpans),
      ...nominalisationSpans(spine),
    ];
    // Contract: spans sorted by start (stable, so ties keep their order).
    return spans.sort((a, b) => a.start - b.start);
  },
};

/** One span per sentence, scored by length. Drives the lane's shading. */
function lengthSpans(sentences: Sentence[]): Span[] {
  return sentences.map((s) => ({
    start: s.start,
    end: s.end,
    layer: LAYER,
    label: "length",
    score: Math.min(s.words.length / LONG_SENTENCE_WORDS, 1),
    note: `${s.words.length} words`,
  }));
}

/** Find maximal runs of sentences whose lengths stay within a small spread. */
function monotoneSpans(sentences: Sentence[]): Span[] {
  const spans: Span[] = [];
  let runStart = 0;

  // Walk forward; when adding sentence i would widen the spread too much,
  // close the current run [runStart, i) and start a new one at i.
  for (let i = 1; i <= sentences.length; i++) {
    const run = sentences.slice(runStart, i + 1).map((s) => s.words.length);
    const spread = Math.max(...run) - Math.min(...run);
    if (i === sentences.length || spread > MONOTONE_SPREAD) {
      if (i - runStart >= MONOTONE_MIN_RUN) {
        const first = sentences[runStart]!;
        const last = sentences[i - 1]!;
        spans.push({
          start: first.start,
          end: last.end,
          layer: LAYER,
          label: "monotone",
          note: `${i - runStart} sentences in a row of about ${first.words.length} words`,
        });
      }
      runStart = i;
    }
  }
  return spans;
}

/** Find "to be" + (optional "-ly" adverb) + past participle within a sentence. */
function passiveSpans(sentence: Sentence): Span[] {
  const spans: Span[] = [];
  const w = sentence.words;

  for (let i = 0; i < w.length - 1; i++) {
    if (!BE_FORMS.has(w[i]!.text.toLowerCase())) continue;

    // Allow one adverb in between: "was quickly passed".
    let j = i + 1;
    if (w[j]!.text.toLowerCase().endsWith("ly") && j + 1 < w.length) j++;

    if (isParticiple(w[j]!.text)) {
      const phrase = sentence.text.slice(w[i]!.start - sentence.start, w[j]!.end - sentence.start);
      spans.push({
        start: w[i]!.start,
        end: w[j]!.end,
        layer: LAYER,
        label: "passive",
        note: `Passive voice: “${phrase}”. Who did it?`,
      });
      i = j; // don't start a second passive inside this one
    }
  }
  return spans;
}

/** Is this word (probably) a past participle? */
function isParticiple(word: string): boolean {
  const w = word.toLowerCase();
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  return w.length >= 4 && w.endsWith("ed") && !ED_ADJECTIVES.has(w);
}

/** Mark nouns made from verbs or adjectives ("implementation", "happiness"). */
function nominalisationSpans(spine: Spine): Span[] {
  return spine.words
    .filter((w) => {
      const lower = w.text.toLowerCase();
      return (
        lower.length >= NOMINAL_MIN_LENGTH &&
        NOMINAL_SUFFIX.test(lower) &&
        !NOMINAL_STOPLIST.has(lower.replace(/s$/, ""))
      );
    })
    .map((w) => ({
      start: w.start,
      end: w.end,
      layer: LAYER,
      label: "nominalisation",
      note: `“${w.text}” is a verb or adjective turned into a noun. Could a verb do the work?`,
    }));
}
