/**
 * M8 — Argument lane.
 *
 * Marker phrases tag claims, evidence and counterclaims. Each sentence with a
 * role gets a "role" span; claims are scored by how well they're backed:
 * 1 = unsupported (no evidence in this or a neighbouring sentence), 0.5 = supported.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { argumentAnalyser } from "../src/analysers/argument";

/** Spans with one label, as their text. */
function found(text: string, label: string): string[] {
  return argumentAnalyser
    .analyse(buildSpine(text))
    .filter((s) => s.label === label)
    .map((s) => text.slice(s.start, s.end));
}

/** The role span of each sentence that has one. */
function roles(text: string) {
  return argumentAnalyser.analyse(buildSpine(text)).filter((s) => s.label === "role");
}

analyserContract(argumentAnalyser);

describe("argument — markers", () => {
  it("marks claim markers, including modal 'must' and 'should'", () => {
    expect(found("Therefore, we must act now.", "claim")).toEqual(["Therefore", "must"]);
  });

  it("marks evidence markers, percentages and citations", () => {
    expect(found("Smith (2020) found that sales fell 20%.", "evidence")).toEqual(["(2020)", "found that", "20%"]);
    expect(found("For example, see [3, 4] and (Lee et al., 2019).", "evidence")).toEqual([
      "For example",
      "[3, 4]",
      "(Lee et al., 2019)",
    ]);
  });

  it("marks counterclaim markers", () => {
    expect(found("However, critics disagree.", "counterclaim")).toEqual(["However", "critics"]);
  });

  it("matches whole words only", () => {
    expect(argumentAnalyser.analyse(buildSpine("The butter melted slowly."))).toEqual([]);
  });
});

describe("argument — roles and support", () => {
  it("scores a claim with no nearby evidence as unsupported (1)", () => {
    const [role] = roles("Therefore, we must act now.");
    expect(role!.score).toBe(1);
    expect(role!.note).toMatch(/unsupported/i);
  });

  it("scores a claim backed by a neighbouring sentence as supported (0.5)", () => {
    const [evidence, claim] = roles("Sales fell 20% last year. Therefore, we must act now.");
    expect(evidence!.score).toBe(0);
    expect(evidence!.note).toMatch(/^Evidence/);
    expect(claim!.score).toBe(0.5);
    expect(claim!.note).toMatch(/supported by sentence 1/i);
  });

  it("counts evidence in the claim's own sentence as support", () => {
    const [role] = roles("We must act now because sales fell.");
    expect(role!.score).toBe(0.5);
    expect(role!.note).toMatch(/supported within the sentence/i);
  });

  it("does not look for support across paragraphs", () => {
    const [, claim] = roles("Sales fell 20% last year.\n\nTherefore, we must act now.");
    expect(claim!.score).toBe(1);
  });

  it("labels a counterclaim that makes no claim of its own", () => {
    const [role] = roles("However, critics disagree.");
    expect(role!.note).toMatch(/^Counterclaim/);
    expect(role!.score).toBe(0);
  });

  it("gives no role to sentences without markers", () => {
    expect(roles("The cat sat on the mat.")).toEqual([]);
  });
});
