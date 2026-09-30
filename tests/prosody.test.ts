/**
 * M7 — Prosody lane.
 *
 * Uses a tiny hand-made dictionary in CMU format, so the tests are fast and
 * don't depend on the 135,000-word real one. One smoke test at the end
 * checks the adapter against the real dictionary.
 */
import { analyserContract } from "./contract";
import { buildSpine } from "../src/spine";
import { cmuPronouncer, createProsodyAnalyser, stressOf } from "../src/analysers/prosody";

/** CMU-style entries: phonemes separated by spaces; vowel digits 1 = stress, 2 = secondary, 0 = none. */
const FIXTURE: Record<string, string> = {
  the: "DH AH0", ball: "B AO1 L", was: "W AA1 Z", kicked: "K IH1 K T",
  it: "IH1 T", is: "IH1 Z", far: "F AA1 R", too: "T UW1", late: "L EY1 T",
  to: "T UW1", act: "AE1 K T", nobody: "N OW1 B AA2 D IY0", noticed: "N OW1 T AH0 S T",
  she: "SH IY1", sang: "S AE1 NG", beautifully: "B Y UW1 T AH0 F L IY0",
  peter: "P IY1 T ER0", piper: "P AY1 P ER0", picked: "P IH1 K T",
  big: "B IH1 G", blue: "B L UW1", bus: "B AH1 S", went: "W EH1 N T", home: "HH OW1 M",
  a: "AH0", cat: "K AE1 T", in: "IH0 N", city: "S IH1 T IY0",
  we: "W IY1", kept: "K EH1 P T", phone: "F OW1 N", fish: "F IH1 SH",
  record: "R AH0 K AO1 R D", "record(2)": "R EH1 K ER0 D",
};

const prosody = createProsodyAnalyser(cmuPronouncer(FIXTURE));

/** Spans with one label, as their text. */
function found(text: string, label: string): string[] {
  return prosody
    .analyse(buildSpine(text))
    .filter((s) => s.label === label)
    .map((s) => text.slice(s.start, s.end));
}

/** The rhythm span of each sentence. */
function rhythm(text: string) {
  return prosody.analyse(buildSpine(text)).filter((s) => s.label === "rhythm");
}

analyserContract(prosody);

describe("cmuPronouncer", () => {
  const say = cmuPronouncer(FIXTURE);

  it("looks words up case-insensitively and returns every pronunciation", () => {
    expect(say("Record")).toEqual([
      ["R", "AH0", "K", "AO1", "R", "D"],
      ["R", "EH1", "K", "ER0", "D"],
    ]);
  });

  it("strips a possessive 's (straight or curly) when the full form is unknown", () => {
    expect(say("Peter's")).toEqual([["P", "IY1", "T", "ER0"]]);
    expect(say("Peter’s")).toEqual([["P", "IY1", "T", "ER0"]]);
  });

  it("returns an empty list for unknown words", () => {
    expect(say("Zorblax")).toEqual([]);
  });
});

describe("stressOf", () => {
  it("maps vowel digits to x (unstressed), / (stressed) and \\ (secondary)", () => {
    expect(stressOf(["N", "OW1", "B", "AA2", "D", "IY0"])).toBe("/\\x");
  });
});

describe("prosody — rhythm", () => {
  it("writes each sentence's stress pattern in the note, word by word", () => {
    const [span] = rhythm("The ball was kicked.");
    // "the" and "was" are function words, so they are read unstressed.
    expect(span!.note).toContain("x / x /");
    expect(span!.note).toContain("4 syllables");
  });

  it("scores stress density: 25% stressed → 0, 75% → 1, linear between", () => {
    // x / x / → 50% stressed → 0.5
    expect(rhythm("The ball was kicked.")[0]!.score).toBeCloseTo(0.5);
    // /\x /x → (1 + 0.5 + 1) / 5 = 50% → 0.5
    expect(rhythm("Nobody noticed.")[0]!.score).toBeCloseTo(0.5);
    // / / → 100% → capped at 1
    expect(rhythm("Went home.")[0]!.score).toBe(1);
  });

  it("marks unknown words as uncertain and leaves them out of the score", () => {
    expect(found("Zorblax went home.", "uncertain")).toEqual(["Zorblax"]);
    const [span] = rhythm("Zorblax went home.");
    expect(span!.note).toContain("?? / /"); // syllables guessed, stress unknown
    expect(span!.score).toBe(1); // only "went home" is scored
  });
});

describe("prosody — weak endings", () => {
  it("flags a sentence that ends on a function word", () => {
    expect(found("Nobody noticed it.", "weak-ending")).toEqual(["it"]);
  });

  it("flags a sentence whose last two syllables are unstressed", () => {
    expect(found("She sang beautifully.", "weak-ending")).toEqual(["beautifully"]);
  });

  it("leaves a sentence that ends on a stress alone", () => {
    expect(found("It is far too late to act.", "weak-ending")).toEqual([]);
  });
});

describe("prosody — alliteration", () => {
  it("groups nearby content words that start with the same consonant sound", () => {
    expect(found("Peter Piper picked it.", "alliteration")).toEqual(["Peter Piper picked"]);
    expect(found("The big blue bus went home.", "alliteration")).toEqual(["big blue bus"]);
  });

  it("goes by sound, not spelling", () => {
    expect(found("We kept the phone, the fish.", "alliteration")).toEqual(["phone, the fish"]);
    expect(found("A cat in the city.", "alliteration")).toEqual([]);
  });

  it("names the sound in its note", () => {
    const [span] = prosody.analyse(buildSpine("Peter Piper picked it.")).filter((s) => s.label === "alliteration");
    expect(span!.note).toMatch(/\/p\//);
  });
});

describe("prosody — ambiguous stress", () => {
  it("flags words whose stress depends on meaning", () => {
    expect(found("We kept a record.", "ambiguous-stress")).toEqual(["record"]);
  });
});

describe("prosody — real CMU dictionary", () => {
  it("reads 'facilitate' with the real dictionary", async () => {
    const { dictionary } = await import("cmu-pronouncing-dictionary");
    const say = cmuPronouncer(dictionary);
    expect(stressOf(say("facilitate")[0]!)).toBe("x/x\\");
  });
});
