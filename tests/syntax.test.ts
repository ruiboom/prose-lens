/**
 * M4 — Syntax lane.
 * Golden fixtures: short sentences with the exact spans expected.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { syntaxAnalyser } from "../src/analysers/syntax";

/** Run the analyser and return spans with one label, as their text. */
function found(text: string, label: string): string[] {
  return syntaxAnalyser
    .analyse(buildSpine(text))
    .filter((s) => s.label === label)
    .map((s) => text.slice(s.start, s.end));
}

analyserContract(syntaxAnalyser);

describe("syntax — passive voice", () => {
  it("marks 'was kicked' as passive on characters 9–19", () => {
    const spans = syntaxAnalyser.analyse(buildSpine("The ball was kicked."));
    const passive = spans.filter((s) => s.label === "passive");
    expect(passive).toHaveLength(1);
    expect(passive[0]).toMatchObject({ start: 9, end: 19 });
  });

  it("includes an adverb between the auxiliary and the participle", () => {
    expect(found("The law was quickly passed.", "passive")).toEqual(["was quickly passed"]);
  });

  it("recognises irregular participles", () => {
    expect(found("The letter was written by Sam. It had been sent.", "passive")).toEqual([
      "was written",
      "been sent",
    ]);
  });

  it("ignores adjectives and progressive verbs", () => {
    expect(found("She was happy. He is walking. They were open.", "passive")).toEqual([]);
  });

  it("explains itself in the span's note", () => {
    const [span] = syntaxAnalyser.analyse(buildSpine("The ball was kicked.")).filter((s) => s.label === "passive");
    expect(span!.note).toMatch(/passive/i);
  });
});

describe("syntax — nominalisations", () => {
  it("marks verbs turned into nouns", () => {
    expect(found("The implementation of the decision required assessment.", "nominalisation")).toEqual([
      "implementation",
      "decision",
      "assessment",
    ]);
  });

  it("skips common words that only look like nominalisations", () => {
    expect(found("The station is near. Wait a moment.", "nominalisation")).toEqual([]);
  });
});

describe("syntax — sentence length", () => {
  it("gives each sentence a length span scored against 40 words", () => {
    const spans = syntaxAnalyser.analyse(buildSpine("One two three. Four five."));
    const lengths = spans.filter((s) => s.label === "length");
    expect(lengths.map((s) => s.score)).toEqual([3 / 40, 2 / 40]);
    expect(lengths[0]!.note).toBe("3 words");
  });

  it("caps the score at 1 for very long sentences", () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ") + ".";
    const [span] = syntaxAnalyser.analyse(buildSpine(long)).filter((s) => s.label === "length");
    expect(span!.score).toBe(1);
  });
});

describe("syntax — monotone rhythm", () => {
  it("flags a run of three or more sentences of similar length", () => {
    const text = "The cat sat down. The dog ran off. The bird flew up. Then everything changed completely for all of them.";
    expect(found(text, "monotone")).toEqual(["The cat sat down. The dog ran off. The bird flew up."]);
  });

  it("does not flag varied sentence lengths", () => {
    expect(found("Stop. The dog ran all the way home again. Why?", "monotone")).toEqual([]);
  });
});
