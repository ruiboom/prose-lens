/**
 * M2 — Text spine.
 *
 * The spine is the shared timeline every lane lines up against, so its
 * offsets must be exact. Every test checks that `text.slice(start, end)`
 * gives back exactly the unit's own text.
 */
import { buildSpine, sentenceAt, type Spine } from "../src/spine";

/** Sentence texts, for readable assertions. */
const sentences = (s: Spine) => s.sentences.map((x) => x.text);
/** Word texts, for readable assertions. */
const words = (s: Spine) => s.words.map((w) => w.text);

/** Invariant: every unit's offsets slice back to its own text. */
function expectOffsetsExact(s: Spine) {
  for (const unit of [...s.paragraphs, ...s.sentences, ...s.words]) {
    expect(s.text.slice(unit.start, unit.end)).toBe(unit.text);
  }
  // Words sit inside their sentence; sentences inside their paragraph.
  for (const sent of s.sentences) {
    const para = s.paragraphs[sent.paragraph]!;
    expect(sent.start).toBeGreaterThanOrEqual(para.start);
    expect(sent.end).toBeLessThanOrEqual(para.end);
    for (const w of sent.words) {
      expect(w.start).toBeGreaterThanOrEqual(sent.start);
      expect(w.end).toBeLessThanOrEqual(sent.end);
    }
  }
}

describe("buildSpine", () => {
  it("returns empty lists for empty or whitespace-only text", () => {
    for (const text of ["", "   \n\n  \t"]) {
      const s = buildSpine(text);
      expect(s.paragraphs).toEqual([]);
      expect(s.sentences).toEqual([]);
      expect(s.words).toEqual([]);
    }
  });

  it("splits two simple sentences with exact offsets", () => {
    const s = buildSpine("The cat sat. The dog ran.");
    expect(sentences(s)).toEqual(["The cat sat.", "The dog ran."]);
    expect(s.sentences[1]!.start).toBe(13);
    expect(s.sentences[1]!.end).toBe(25);
    expectOffsetsExact(s);
  });

  it("does not split after common abbreviations", () => {
    const s = buildSpine("Dr. Smith met Mrs. Jones. They talked.");
    expect(sentences(s)).toEqual(["Dr. Smith met Mrs. Jones.", "They talked."]);
    expectOffsetsExact(s);
  });

  it("does not split after e.g. / i.e. or before a lowercase word", () => {
    const s = buildSpine("Fruit, e.g. apples, is good. Wait... what now?");
    expect(sentences(s)).toEqual(["Fruit, e.g. apples, is good.", "Wait... what now?"]);
  });

  it("does not split after single initials", () => {
    const s = buildSpine("J. R. R. Tolkien wrote it. He was slow.");
    expect(sentences(s)).toEqual(["J. R. R. Tolkien wrote it.", "He was slow."]);
  });

  it("keeps closing curly quotes and brackets with their sentence", () => {
    const s = buildSpine("“Stop!” She left. (He stayed.) Fine.");
    expect(sentences(s)).toEqual(["“Stop!”", "She left.", "(He stayed.)", "Fine."]);
    expectOffsetsExact(s);
  });

  it("handles ?! and multiple spaces between sentences", () => {
    const s = buildSpine("Really?!   Yes.");
    expect(sentences(s)).toEqual(["Really?!", "Yes."]);
    expectOffsetsExact(s);
  });

  it("treats a final sentence without punctuation as a sentence", () => {
    expect(sentences(buildSpine("One. Two"))).toEqual(["One.", "Two"]);
  });

  it("uses UTF-16 offsets so emoji and accents slice correctly", () => {
    const s = buildSpine("I love 🍕 café. It is good.");
    expect(sentences(s)).toEqual(["I love 🍕 café.", "It is good."]);
    expect(words(s)).toContain("café");
    expectOffsetsExact(s);
  });

  it("splits paragraphs on blank lines and records each sentence's paragraph", () => {
    const text = "First para. Still first.\n\n  \nSecond para.\n\n\nThird.";
    const s = buildSpine(text);
    expect(s.paragraphs.map((p) => p.text)).toEqual([
      "First para. Still first.",
      "Second para.",
      "Third.",
    ]);
    expect(s.sentences.map((x) => x.paragraph)).toEqual([0, 0, 1, 2]);
    expectOffsetsExact(s);
  });

  it("does not split a sentence on a single line break", () => {
    const s = buildSpine("A line\nthat wraps.");
    expect(sentences(s)).toEqual(["A line\nthat wraps."]);
  });

  it("keeps contractions and hyphenated words whole, drops punctuation", () => {
    const s = buildSpine("Don't use well-known clichés, 42 times!");
    expect(words(s)).toEqual(["Don't", "use", "well-known", "clichés", "42", "times"]);
    expectOffsetsExact(s);
  });

  it("numbers sentences and words in document order", () => {
    const s = buildSpine("One two. Three.");
    expect(s.sentences.map((x) => x.index)).toEqual([0, 1]);
    expect(s.words.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(s.words.map((w) => w.sentence)).toEqual([0, 0, 1]);
  });
});

describe("sentenceAt", () => {
  const s = buildSpine("The cat sat. The dog ran.");

  it("finds the sentence containing an offset", () => {
    expect(sentenceAt(s, 0)?.index).toBe(0);
    expect(sentenceAt(s, 14)?.index).toBe(1);
  });

  it("maps the gap between sentences to the previous sentence", () => {
    // Offset 12 is the space after "sat." — a caret there belongs to sentence 0.
    expect(sentenceAt(s, 12)?.index).toBe(0);
  });

  it("returns undefined for empty text", () => {
    expect(sentenceAt(buildSpine(""), 0)).toBeUndefined();
  });
});
