/**
 * M3 — Analyser registry.
 *
 * Proves the contract suite with a tiny fake analyser, then tests the
 * registry: registering, running every analyser, and isolating failures
 * so one broken lane never takes down the others.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { createRegistry } from "../src/analysers/registry";
import type { Analyser } from "../src/analysers/types";

/** Fake analyser: marks every word longer than five letters. */
const longWords: Analyser = {
  id: "long-words",
  name: "Long words",
  description: "Marks words longer than five letters.",
  analyse: (spine) =>
    spine.words
      .filter((w) => w.text.length > 5)
      .map((w) => ({ start: w.start, end: w.end, layer: "long-words", label: "long" })),
};

/** Broken analyser: always throws. */
const broken: Analyser = {
  id: "broken",
  name: "Broken",
  description: "Always throws.",
  analyse: () => {
    throw new Error("boom");
  },
};

/** Sloppy analyser: returns one good span and several invalid ones. */
const sloppy: Analyser = {
  id: "sloppy",
  name: "Sloppy",
  description: "Returns some invalid spans.",
  analyse: () => [
    { start: 0, end: 3, layer: "sloppy", label: "ok" },
    { start: 5, end: 2, layer: "sloppy", label: "backwards" },
    { start: 0, end: 9999, layer: "sloppy", label: "too-long" },
    { start: 0, end: 3, layer: "sloppy", label: "bad-score", score: 7 },
  ],
};

analyserContract(longWords);

describe("createRegistry", () => {
  it("lists analysers in the order they were registered", () => {
    const reg = createRegistry([longWords, sloppy]);
    expect(reg.list().map((a) => a.id)).toEqual(["long-words", "sloppy"]);
  });

  it("refuses two analysers with the same id", () => {
    expect(() => createRegistry([longWords, longWords])).toThrow(/duplicate/i);
  });

  it("runs every analyser and groups spans by layer", () => {
    const result = createRegistry([longWords]).runAll(buildSpine("A tremendous elephant."));
    expect(result.spans["long-words"]!.map((s) => s.label)).toEqual(["long", "long"]);
    expect(result.errors).toEqual({});
  });

  it("isolates an analyser that throws and reports its error", () => {
    const result = createRegistry([broken, longWords]).runAll(buildSpine("Elephants trumpet."));
    expect(result.spans["broken"]).toEqual([]);
    expect(result.errors["broken"]).toMatch(/boom/);
    expect(result.spans["long-words"]).toHaveLength(2);
  });

  it("drops invalid spans rather than drawing them", () => {
    const result = createRegistry([sloppy]).runAll(buildSpine("Some text here."));
    expect(result.spans["sloppy"]!.map((s) => s.label)).toEqual(["ok"]);
  });
});
