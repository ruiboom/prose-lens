/**
 * M9 — References lane.
 *
 * Matches in-text citations to the reference list at the end of the text.
 * Author–date keys are surname + year; numbered keys are the numbers.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { referencesAnalyser } from "../src/analysers/references";

/** Spans with one label, as their text. */
function found(text: string, label: string): string[] {
  return referencesAnalyser
    .analyse(buildSpine(text))
    .filter((s) => s.label === label)
    .map((s) => text.slice(s.start, s.end));
}

const AUTHOR_DATE = `Cats sleep a lot (Smith, 2020). Jones (2019) disagrees. Dogs bark (Brown & Lee, 2018; Green, 2017).

References
Smith, J. (2020). Sleep in cats. Journal of Cats.
Jones, K. (2019). Awake cats. Cat Review.
Brown, A., & Lee, B. (2018). Barking. Dog Press.
White, C. (2015). Unused work. Nowhere.`;

const NUMBERED = `Cats sleep [1]. Dogs bark [2–3].

## Works Cited
[1] Smith. Cats.
[2] Jones. Dogs.`;

analyserContract(referencesAnalyser);

describe("references — author–date", () => {
  it("marks parenthetical and narrative citations that match an entry", () => {
    expect(found(AUTHOR_DATE, "citation")).toEqual(["(Smith, 2020)", "Jones (2019)"]);
  });

  it("marks a citation group with any unmatched source as an orphan, naming it", () => {
    expect(found(AUTHOR_DATE, "orphan-citation")).toEqual(["(Brown & Lee, 2018; Green, 2017)"]);
    const [orphan] = referencesAnalyser.analyse(buildSpine(AUTHOR_DATE)).filter((s) => s.label === "orphan-citation");
    expect(orphan!.note).toMatch(/Green 2017/);
  });

  it("marks reference-list entries as cited or uncited", () => {
    expect(found(AUTHOR_DATE, "entry")).toEqual([
      "Smith, J. (2020). Sleep in cats. Journal of Cats.",
      "Jones, K. (2019). Awake cats. Cat Review.",
      "Brown, A., & Lee, B. (2018). Barking. Dog Press.",
    ]);
    expect(found(AUTHOR_DATE, "uncited")).toEqual(["White, C. (2015). Unused work. Nowhere."]);
  });

  it("handles 'et al.' and page numbers", () => {
    const text = "Birds sing (Lee et al., 2019, p. 4).\n\nReferences\nLee, K., Park, J., & Kim, S. (2019). Song.";
    expect(found(text, "citation")).toEqual(["(Lee et al., 2019, p. 4)"]);
  });
});

describe("references — numbered", () => {
  it("matches [n] citations, expanding ranges, under any common heading", () => {
    expect(found(NUMBERED, "citation")).toEqual(["[1]"]);
    expect(found(NUMBERED, "orphan-citation")).toEqual(["[2–3]"]);
    expect(found(NUMBERED, "uncited")).toEqual([]);
  });
});

describe("references — sourcing score", () => {
  it("shades problem sentences 1 and properly cited ones 0.4", () => {
    const spans = referencesAnalyser.analyse(buildSpine(AUTHOR_DATE)).filter((s) => s.label === "sourcing");
    const scoreOf = (snippet: string) =>
      spans.find((s) => AUTHOR_DATE.slice(s.start, s.end).includes(snippet))!.score;
    expect(scoreOf("Cats sleep")).toBe(0.4);
    expect(scoreOf("Dogs bark")).toBe(1);
    expect(scoreOf("Unused work")).toBe(1);
  });
});

describe("references — no reference list", () => {
  it("still marks citations, saying there is nothing to check them against", () => {
    const text = "Cats sleep (Smith, 2020).";
    expect(found(text, "citation")).toEqual(["(Smith, 2020)"]);
    const [cite] = referencesAnalyser.analyse(buildSpine(text)).filter((s) => s.label === "citation");
    expect(cite!.note).toMatch(/no reference list/i);
  });

  it("ignores brackets that are not citations", () => {
    expect(referencesAnalyser.analyse(buildSpine("It grew in the 1990s (a boom). See page 4 (above)."))).toEqual([]);
  });
});
