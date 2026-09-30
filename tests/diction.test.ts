/**
 * M5 — Diction lane.
 * Golden fixtures for Latinate words, long words, repetition, clichés and density.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { dictionAnalyser } from "../src/analysers/diction";

/** Run the analyser and return spans with one label, as their text. */
function found(text: string, label: string): string[] {
  return dictionAnalyser
    .analyse(buildSpine(text))
    .filter((s) => s.label === label)
    .map((s) => text.slice(s.start, s.end));
}

analyserContract(dictionAnalyser);

describe("diction — Latinate words", () => {
  it("marks words with Latinate suffixes", () => {
    expect(found("The committee will facilitate the implementation.", "latinate")).toEqual([
      "facilitate",
      "implementation",
    ]);
  });

  it("leaves plain Anglo-Saxon words alone", () => {
    expect(found("We got the big dog home.", "latinate")).toEqual([]);
  });
});

describe("diction — long words", () => {
  it("marks words of 12 letters or more", () => {
    expect(found("An extraordinarily simple idea.", "long-word")).toEqual(["extraordinarily"]);
  });
});

describe("diction — repetition", () => {
  it("marks a content word repeated nearby, but not stopwords", () => {
    expect(found("The model works. The model fails.", "repetition")).toEqual(["model"]);
  });

  it("ignores case when matching", () => {
    expect(found("Rivers flood. rivers dry.", "repetition")).toEqual(["rivers"]);
  });

  it("does not flag repeats more than 30 words apart", () => {
    const filler = Array.from({ length: 35 }, () => "and").join(" ");
    expect(found(`Model ${filler} model.`, "repetition")).toEqual([]);
  });

  it("says how far back the earlier use was", () => {
    const [span] = dictionAnalyser.analyse(buildSpine("The model works. The model fails.")).filter(
      (s) => s.label === "repetition",
    );
    expect(span!.note).toMatch(/3 words earlier/);
  });
});

describe("diction — clichés", () => {
  it("marks a cliché phrase with exact offsets", () => {
    const text = "At the end of the day, it works.";
    const spans = dictionAnalyser.analyse(buildSpine(text)).filter((s) => s.label === "cliche");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ start: 0, end: 21 });
  });

  it("matches across line breaks and extra spaces", () => {
    expect(found("It was low-hanging\nfruit, first  and foremost.", "cliche")).toEqual([
      "low-hanging\nfruit",
      "first  and foremost",
    ]);
  });
});

describe("diction — density", () => {
  it("scores each sentence by the share of its words flagged, full at 30%", () => {
    // 1 of 10 words flagged → 0.1 / 0.3 ≈ 0.33; 2 of 4 → capped at 1; none → 0.
    const text = "We should facilitate a plan that we can all follow. Facilitate implementation now please. Go home.";
    const spans = dictionAnalyser.analyse(buildSpine(text));
    const scores = spans.filter((s) => s.label === "density").map((s) => s.score!);
    expect(scores[0]).toBeCloseTo(1 / 3);
    expect(scores.slice(1)).toEqual([1, 0]);
  });
});
