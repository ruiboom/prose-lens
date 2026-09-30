/**
 * argument.ts — the Argument lane (heuristic).
 *
 * Finds the bones of an argument from discourse markers, the signposts
 * writers use to say what a sentence is doing:
 *   - claim         "therefore", "must", "should", "in conclusion"…
 *   - evidence      "because", "for example", "found that", 20%, (Smith, 2020), [3]…
 *   - counterclaim  "however", "although", "critics"…
 * Each of these marks the marker phrase itself.
 *
 *   - role          one span per sentence that has a role. Its note says what
 *                   the sentence does and, for a claim, what backs it.
 *                   Score (shading) = how exposed a claim is:
 *                     1   = unsupported claim: no evidence in the sentence or
 *                           the sentences either side (same paragraph)
 *                     0.5 = supported claim
 *                     0   = evidence or counterclaim
 *
 * Markers catch explicit arguments only. Implicit claims ("Cats are better
 * than dogs.") have no marker and are missed; the LLM lane covers those.
 */
import type { Sentence, Spine } from "../spine";
import type { Analyser, Span } from "./types";

const LAYER = "argument";

const CLAIM_MARKERS = [
  "therefore", "thus", "hence", "consequently", "as a result", "it follows that",
  "we conclude", "in conclusion", "in short", "clearly", "must", "should",
  "ought to", "need to", "i argue", "we argue", "i believe", "we believe",
];

const EVIDENCE_MARKERS = [
  "because", "since", "for example", "for instance", "such as", "according to",
  "studies show", "research shows", "research suggests", "data show", "data shows",
  "found that", "evidence", "statistics", "survey", "e.g.",
];

const COUNTER_MARKERS = [
  "however", "but", "although", "though", "nevertheless", "nonetheless",
  "on the other hand", "critics", "some argue", "opponents", "admittedly",
  "despite", "whereas", "even so", "in contrast", "conversely",
];

/** Author–date citations: (2020), (Smith, 2020), (Lee et al., 2019a). */
const AUTHOR_DATE = /\((?:[^()]{0,80}?,\s*)?\d{4}[a-z]?\)/gu;
/** Numbered citations: [3], [3, 4], [3–5]. */
const NUMBERED = /\[\d+(?:\s*[,–-]\s*\d+)*\]/g;
/** Percentages: 20%, 3.5 per cent, 12 percent. */
const PERCENT = /\d+(?:\.\d+)?\s?(?:%|per\s?cent\b)/giu;

/** Build one case-insensitive, whole-word regex from a phrase list. */
function phrasePattern(phrases: string[]): RegExp {
  const alternatives = [...phrases]
    .sort((a, b) => b.length - a.length) // longest first: "for example" before "for"
    .map((p) => p.split(" ").map(escapeRegExp).join("\\s+"));
  // Letter look-arounds instead of \b, so "e.g." (ending in a dot) still matches.
  return new RegExp(`(?<![\\p{L}])(?:${alternatives.join("|")})(?![\\p{L}])`, "giu");
}

const CLAIM = [phrasePattern(CLAIM_MARKERS)];
const EVIDENCE = [phrasePattern(EVIDENCE_MARKERS), AUTHOR_DATE, NUMBERED, PERCENT];
const COUNTER = [phrasePattern(COUNTER_MARKERS)];

/** What one sentence does in the argument. */
interface SentenceRole {
  sentence: Sentence;
  claims: Span[];
  evidence: Span[];
  counters: Span[];
}

export const argumentAnalyser: Analyser = {
  id: LAYER,
  name: "Argument",
  description: "Claims, evidence and counterclaims; claims with no support.",

  analyse(spine: Spine): Span[] {
    const found: SentenceRole[] = spine.sentences.map((sentence) => ({
      sentence,
      claims: markers(sentence, CLAIM, "claim", "Claim marker"),
      evidence: markers(sentence, EVIDENCE, "evidence", "Evidence marker"),
      counters: markers(sentence, COUNTER, "counterclaim", "Counterclaim marker"),
    }));

    const spans: Span[] = [];
    found.forEach((r, i) => {
      spans.push(...r.claims, ...r.evidence, ...r.counters);
      const role = roleSpan(r, found[i - 1], found[i + 1]);
      if (role) spans.push(role);
    });
    return spans.sort((a, b) => a.start - b.start);
  },
};

/** Find every marker from `patterns` in the sentence, dropping overlaps. */
function markers(sentence: Sentence, patterns: RegExp[], label: string, what: string): Span[] {
  const hits: Span[] = [];
  for (const pattern of patterns) {
    for (const m of sentence.text.matchAll(pattern)) {
      const start = sentence.start + m.index;
      hits.push({ start, end: start + m[0].length, layer: LAYER, label, note: `${what}: “${m[0]}”` });
    }
  }
  // Two patterns can hit the same text (e.g. a % inside a citation): keep the first.
  hits.sort((a, b) => a.start - b.start);
  return hits.filter((h, i) => i === 0 || h.start >= hits[i - 1]!.end);
}

/** Decide the sentence's role and, for a claim, look for support next door. */
function roleSpan(r: SentenceRole, prev: SentenceRole | undefined, next: SentenceRole | undefined): Span | undefined {
  const base = { start: r.sentence.start, end: r.sentence.end, layer: LAYER, label: "role" };

  if (r.claims.length) {
    if (r.evidence.length) return { ...base, score: 0.5, note: "Claim, supported within the sentence" };
    // Neighbours count only inside the same paragraph.
    const backer = [prev, next].find((n) => n && n.evidence.length && n.sentence.paragraph === r.sentence.paragraph);
    if (backer) return { ...base, score: 0.5, note: `Claim, supported by sentence ${backer.sentence.index + 1}` };
    return { ...base, score: 1, note: "Unsupported claim: no evidence in this sentence or the ones either side" };
  }
  if (r.counters.length) return { ...base, score: 0, note: "Counterclaim or concession" };
  if (r.evidence.length) return { ...base, score: 0, note: "Evidence" };
  return undefined;
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
