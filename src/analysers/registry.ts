/**
 * registry.ts — holds the analysers and runs them over a spine.
 *
 * Two safety nets live here, so the UI can trust whatever comes out:
 *   1. An analyser that throws is isolated: its lane shows an error,
 *      and every other lane still draws.
 *   2. Invalid spans (outside the text, backwards, bad score, wrong layer)
 *      are dropped, never drawn.
 */
import type { Spine } from "../spine";
import type { Analyser, Span } from "./types";

/** The output of one full analysis pass. */
export interface AnalysisResult {
  /** Valid spans for each analyser, keyed by analyser id. */
  spans: Record<string, Span[]>;
  /** Error message for each analyser that threw, keyed by analyser id. */
  errors: Record<string, string>;
}

export interface Registry {
  /** All analysers, in registration order (this is also the lane order). */
  list(): Analyser[];
  /** Run every analyser over the spine. Never throws. */
  runAll(spine: Spine): AnalysisResult;
}

/**
 * Create a registry from a list of analysers.
 * @throws if two analysers share an id (their lanes would collide).
 */
export function createRegistry(analysers: Analyser[]): Registry {
  const seen = new Set<string>();
  for (const a of analysers) {
    if (seen.has(a.id)) throw new Error(`Duplicate analyser id: ${a.id}`);
    seen.add(a.id);
  }

  return {
    list: () => [...analysers],

    runAll(spine) {
      const result: AnalysisResult = { spans: {}, errors: {} };
      for (const a of analysers) {
        try {
          result.spans[a.id] = a.analyse(spine).filter((s) => isValidSpan(s, a.id, spine.text.length));
        } catch (err) {
          result.spans[a.id] = [];
          result.errors[a.id] = err instanceof Error ? err.message : String(err);
        }
      }
      return result;
    },
  };
}

/** Check one span against the rules in the analyser contract. */
export function isValidSpan(s: Span, layer: string, textLength: number): boolean {
  return (
    s.layer === layer &&
    Number.isInteger(s.start) &&
    Number.isInteger(s.end) &&
    s.start >= 0 &&
    s.end <= textLength &&
    s.start < s.end &&
    (s.score === undefined || (s.score >= 0 && s.score <= 1))
  );
}
