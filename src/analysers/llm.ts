/**
 * llm.ts — the LLM lane.
 *
 * Unlike the other lanes, this one can't analyse on every keystroke: asking
 * Claude costs money and takes seconds. So the lane is split in two:
 *   - the panel (src/llm/panel.ts) runs Claude on demand and calls setReadings
 *   - the analyser here stays instant: it just redraws the stored readings
 *
 * Readings are stored by SENTENCE TEXT, not position. Editing one sentence
 * drops only that sentence's reading, and inserting text above doesn't
 * shift readings onto the wrong sentences. Like sticky notes on the
 * sentences themselves rather than on line numbers.
 *
 * Labels:
 *   - reading   one span per read sentence; its note gives the role,
 *               support, register and Claude's reason. Score (shading):
 *               1 = unsupported claim, 0.5 = supported claim, 0 = other
 *               (the same scale as the Argument lane, so the two compare)
 *   - claim / evidence / warrant / counterclaim
 *               the phrase Claude quoted, found inside the sentence. If the
 *               quote isn't really there, no phrase is marked.
 */
import type { Spine } from "../spine";
import type { Analyser, Span } from "./types";
import type { Reading } from "../llm/parse";

const LAYER = "llm";

export interface LlmLane {
  analyser: Analyser;
  /** Store Claude's readings for the sentences of `spine` (replacing older ones). */
  setReadings(spine: Spine, readings: Reading[]): void;
  /** How many sentences in `spine` have no reading (new or edited since the last run). */
  staleCount(spine: Spine): number;
}

export function createLlmLane(): LlmLane {
  /** Sentence text → Claude's reading of it. */
  const store = new Map<string, Reading>();

  const analyser: Analyser = {
    id: LAYER,
    name: "Claude",
    description: "Claude's reading of each sentence's role. Runs on demand.",

    analyse(spine: Spine): Span[] {
      const spans: Span[] = [];
      for (const s of spine.sentences) {
        const r = store.get(s.text);
        if (!r) continue;

        spans.push({
          start: s.start,
          end: s.end,
          layer: LAYER,
          label: "reading",
          score: r.role === "claim" ? (r.support === "unsupported" ? 1 : 0.5) : 0,
          note: describe(r),
        });

        // Mark the quoted phrase, if it's really in the sentence.
        const at = r.role !== "none" && r.quote ? s.text.indexOf(r.quote) : -1;
        if (at >= 0) {
          spans.push({
            start: s.start + at,
            end: s.start + at + r.quote.length,
            layer: LAYER,
            label: r.role,
            note: `Claude: ${r.role}`,
          });
        }
      }
      return spans.sort((a, b) => a.start - b.start);
    },
  };

  return {
    analyser,
    setReadings(spine, readings) {
      store.clear();
      for (const r of readings) {
        const sentence = spine.sentences[r.n - 1];
        if (sentence) store.set(sentence.text, r);
      }
    },
    staleCount: (spine) => spine.sentences.filter((s) => !store.has(s.text)).length,
  };
}

/** One-line summary of a reading, e.g. "Claim (unsupported) · formal · An implicit claim…". */
function describe(r: Reading): string {
  const role = r.role === "none" ? "No argumentative role" : r.role[0]!.toUpperCase() + r.role.slice(1);
  const parts = [r.support ? `${role} (${r.support})` : role, `${r.register} register`];
  if (r.note) parts.push(r.note);
  return parts.join(" · ");
}
