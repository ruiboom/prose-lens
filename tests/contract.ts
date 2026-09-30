/**
 * The analyser contract — a shared test suite every analyser must pass.
 *
 * Call `analyserContract(analyser)` from an analyser's test file. It checks
 * the rules that keep lanes lined up with the text, whatever the analyser does:
 *   - spans sit inside the text, with start < end
 *   - every span's layer is the analyser's id
 *   - spans are sorted by start
 *   - spans with the same label never overlap
 *   - scores, when given, are between 0 and 1
 *   - the same text always gives the same spans (deterministic)
 */
import { buildSpine } from "../src/spine";
import type { Analyser } from "../src/analysers/types";

/** Varied sample texts: plain, tricky punctuation, multi-paragraph, empty. */
export const CONTRACT_SAMPLES = [
  "",
  "The cat sat on the mat.",
  "Dr. Smith said, “It was decided that the policy would be implemented.” Nobody objected!",
  "First paragraph here. It has two sentences.\n\nSecond paragraph, which is longer, winds on and on through several clauses, because it can; however, it ends.",
  "Emoji 🍕 and café. Well-known clichés are, at the end of the day, avoided.",
];

export function analyserContract(analyser: Analyser): void {
  describe(`${analyser.name} — analyser contract`, () => {
    it("has an id, a name and a description", () => {
      expect(analyser.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(analyser.name.length).toBeGreaterThan(0);
      expect(analyser.description.length).toBeGreaterThan(0);
    });

    it("returns no spans for empty text", () => {
      expect(analyser.analyse(buildSpine(""))).toEqual([]);
    });

    for (const text of CONTRACT_SAMPLES.filter(Boolean)) {
      describe(`on "${text.slice(0, 30)}…"`, () => {
        const spine = buildSpine(text);
        const spans = analyser.analyse(spine);

        it("keeps spans inside the text with start < end", () => {
          for (const s of spans) {
            expect(s.start).toBeGreaterThanOrEqual(0);
            expect(s.end).toBeLessThanOrEqual(text.length);
            expect(s.start).toBeLessThan(s.end);
          }
        });

        it("labels every span with its own layer id", () => {
          for (const s of spans) expect(s.layer).toBe(analyser.id);
        });

        it("returns spans sorted by start", () => {
          const starts = spans.map((s) => s.start);
          expect(starts).toEqual([...starts].sort((a, b) => a - b));
        });

        it("never overlaps two spans with the same label", () => {
          const byLabel = new Map<string, typeof spans>();
          for (const s of spans) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
          for (const group of byLabel.values()) {
            for (let i = 1; i < group.length; i++) {
              expect(group[i]!.start).toBeGreaterThanOrEqual(group[i - 1]!.end);
            }
          }
        });

        it("keeps scores between 0 and 1", () => {
          for (const s of spans) {
            if (s.score !== undefined) {
              expect(s.score).toBeGreaterThanOrEqual(0);
              expect(s.score).toBeLessThanOrEqual(1);
            }
          }
        });

        it("is deterministic", () => {
          expect(analyser.analyse(buildSpine(text))).toEqual(spans);
        });
      });
    }
  });
}
