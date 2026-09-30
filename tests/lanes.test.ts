/**
 * M6 — Lane model and rendering.
 *
 * The lane model is a pure summary: for each lane, one cell per sentence.
 * A cell's shade is the highest score of that lane's spans in the sentence;
 * its labels are the unscored spans (passive, cliché, …) found there.
 */
import { buildSpine } from "../src/spine";
import { buildLaneModel, renderLanes } from "../src/lanes";
import type { Analyser } from "../src/analysers/types";
import type { AnalysisResult } from "../src/analysers/registry";

const spine = buildSpine("The ball was kicked. Go home.");

const fake: Analyser = { id: "fake", name: "Fake", description: "A fake lane.", analyse: () => [] };
const other: Analyser = { id: "other", name: "Other", description: "Another lane.", analyse: () => [] };

/** Hand-made analysis result: shading scores plus one unscored label. */
const result: AnalysisResult = {
  spans: {
    fake: [
      { start: 0, end: 20, layer: "fake", label: "length", score: 0.25, note: "4 words" },
      { start: 9, end: 19, layer: "fake", label: "passive", note: "Passive voice" },
      { start: 21, end: 29, layer: "fake", label: "length", score: 0.5, note: "2 words" },
    ],
    other: [],
  },
  errors: { other: "Network down" },
};

describe("buildLaneModel", () => {
  const model = buildLaneModel(spine, result, [fake, other]);

  it("makes one lane per analyser, in order", () => {
    expect(model.map((l) => l.id)).toEqual(["fake", "other"]);
  });

  it("makes one cell per sentence, shaded by the highest score", () => {
    expect(model[0]!.cells.map((c) => c.score)).toEqual([0.25, 0.5]);
  });

  it("lists unscored labels found in each sentence", () => {
    expect(model[0]!.cells.map((c) => c.labels)).toEqual([["passive"], []]);
  });

  it("keeps every span in the sentence for the detail view", () => {
    expect(model[0]!.cells[0]!.spans.map((s) => s.label)).toEqual(["length", "passive"]);
  });

  it("sizes each cell by its share of the sentence text", () => {
    const [a, b] = model[0]!.cells;
    // "The ball was kicked." = 20 chars, "Go home." = 8 chars.
    expect(a!.width).toBeCloseTo(20 / 28);
    expect(b!.width).toBeCloseTo(8 / 28);
  });

  it("carries an analyser's error onto its lane", () => {
    expect(model[1]!.error).toBe("Network down");
  });
});

describe("renderLanes", () => {
  const model = buildLaneModel(spine, result, [fake, other]);

  it("draws a strip with one cell per sentence for each lane", () => {
    const el = document.createElement("div");
    renderLanes(el, model, { selected: undefined, hidden: new Set() });
    const lanes = el.querySelectorAll(".lane");
    expect(lanes).toHaveLength(2);
    expect(lanes[0]!.querySelectorAll(".cell")).toHaveLength(2);
  });

  it("marks the selected sentence's cell in every lane", () => {
    const el = document.createElement("div");
    // Both lanes succeed here, so both draw a strip.
    const ok = buildLaneModel(spine, { ...result, errors: {} }, [fake, other]);
    renderLanes(el, ok, { selected: 1, hidden: new Set() });
    const strips = el.querySelectorAll(".strip");
    expect(strips).toHaveLength(2);
    for (const strip of strips) {
      const cells = strip.querySelectorAll(".cell");
      expect(cells[1]!.classList.contains("selected")).toBe(true);
      expect(cells[0]!.classList.contains("selected")).toBe(false);
    }
  });

  it("collapses hidden lanes but keeps their header", () => {
    const el = document.createElement("div");
    renderLanes(el, model, { selected: undefined, hidden: new Set(["fake"]) });
    const lane = el.querySelector('.lane[data-lane="fake"]')!;
    expect(lane.classList.contains("hidden")).toBe(true);
    expect(lane.querySelector(".lane-name")!.textContent).toBe("Fake");
  });

  it("colours a lane by its id, so colours don't shift when lanes are added", () => {
    const el = document.createElement("div");
    renderLanes(el, model, { selected: undefined, hidden: new Set() });
    const lane = el.querySelector<HTMLElement>('.lane[data-lane="fake"]')!;
    expect(lane.style.getPropertyValue("--lane-colour")).toContain("--lane-fake");
  });

  it("shows an analyser's error in its lane", () => {
    const el = document.createElement("div");
    renderLanes(el, model, { selected: undefined, hidden: new Set() });
    expect(el.querySelector('.lane[data-lane="other"] .lane-error')!.textContent).toMatch(/Network down/);
  });
});
