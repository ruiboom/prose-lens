/**
 * lanes.ts — turns analysis results into lanes, and draws them.
 *
 * Two steps, kept separate so the logic is testable without a browser:
 *   1. buildLaneModel: pure data. For each analyser, one cell per sentence.
 *   2. renderLanes:    DOM. One SVG strip per lane, one <rect> per cell.
 *
 * Cell rules (the same for every lane, so any new analyser just works):
 *   - shade  = the highest `score` of the lane's spans touching the sentence
 *   - labels = the distinct labels of *unscored* spans there (passive, cliché…),
 *              shown as a marker along the bottom of the cell
 *   - width  = the sentence's share of all sentence text, so the strip reads
 *              like a scaled-down copy of the document (a minimap)
 */
import type { Spine } from "./spine";
import type { Analyser, Span } from "./analysers/types";
import type { AnalysisResult } from "./analysers/registry";

/** One sentence's summary within one lane. */
export interface LaneCell {
  sentence: number;
  /** 0–1 shade for this cell. */
  score: number;
  /** Distinct unscored labels in this sentence, in order of appearance. */
  labels: string[];
  /** Every span of this lane that touches the sentence (for the detail view). */
  spans: Span[];
  /** Left edge, as a fraction (0–1) of the strip. */
  x: number;
  /** Width, as a fraction (0–1) of the strip. */
  width: number;
}

/** One lane: an analyser's reading of the whole document. */
export interface LaneModel {
  id: string;
  name: string;
  description: string;
  /** Set when the analyser threw; the lane then shows this instead of cells. */
  error?: string;
  cells: LaneCell[];
}

/** What the view needs besides the model. */
export interface LaneViewState {
  /** Index of the selected sentence, if any. */
  selected: number | undefined;
  /** Ids of lanes the user has collapsed. */
  hidden: Set<string>;
}

/**
 * Fallback colours by position, for lanes without their own `--lane-<id>`
 * CSS variable. Built-in lanes are coloured by id (see styles.css), so a
 * lane keeps its colour when others load in around it.
 */
const FALLBACK_COLOURS = ["--lane-1", "--lane-2", "--lane-3", "--lane-4", "--lane-5", "--lane-6"];

/** SVG strip size in viewBox units (stretched to the panel width by CSS). */
const STRIP_WIDTH = 1000;
const STRIP_HEIGHT = 28;
const MARKER_HEIGHT = 5;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Summarise the analysis into one lane per analyser, one cell per sentence. */
export function buildLaneModel(spine: Spine, result: AnalysisResult, analysers: Analyser[]): LaneModel[] {
  const totalChars = spine.sentences.reduce((sum, s) => sum + (s.end - s.start), 0) || 1;

  return analysers.map((a) => {
    const spans = result.spans[a.id] ?? [];
    let x = 0;

    const cells = spine.sentences.map((sentence) => {
      // A span touches a sentence if their ranges overlap at all.
      const inside = spans.filter((sp) => sp.start < sentence.end && sp.end > sentence.start);
      const scores = inside.flatMap((sp) => (sp.score === undefined ? [] : [sp.score]));
      const labels = [...new Set(inside.filter((sp) => sp.score === undefined).map((sp) => sp.label))];
      const width = (sentence.end - sentence.start) / totalChars;
      const cell: LaneCell = {
        sentence: sentence.index,
        score: scores.length ? Math.max(...scores) : 0,
        labels,
        spans: inside,
        x,
        width,
      };
      x += width;
      return cell;
    });

    const lane: LaneModel = { id: a.id, name: a.name, description: a.description, cells };
    const error = result.errors[a.id];
    if (error !== undefined) lane.error = error;
    return lane;
  });
}

/** Draw every lane into `container`, replacing what was there. */
export function renderLanes(container: HTMLElement, model: LaneModel[], state: LaneViewState): void {
  container.replaceChildren(...model.map((lane, i) => renderLane(lane, i, state)));
}

/** Draw one lane: a header with a show/hide checkbox, then the strip (or an error). */
function renderLane(lane: LaneModel, index: number, state: LaneViewState): HTMLElement {
  const hidden = state.hidden.has(lane.id);

  const el = document.createElement("section");
  el.className = hidden ? "lane hidden" : "lane";
  el.dataset.lane = lane.id;
  el.style.setProperty(
    "--lane-colour",
    `var(--lane-${lane.id}, var(${FALLBACK_COLOURS[index % FALLBACK_COLOURS.length]}))`,
  );

  // Header: checkbox + name + one-line description.
  const header = document.createElement("label");
  header.className = "lane-header";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !hidden;
  toggle.dataset.lane = lane.id;
  const name = document.createElement("span");
  name.className = "lane-name";
  name.textContent = lane.name;
  const desc = document.createElement("span");
  desc.className = "lane-desc";
  desc.textContent = lane.description;
  header.append(toggle, name, desc);
  el.append(header);

  if (hidden) return el;

  if (lane.error !== undefined) {
    const err = document.createElement("p");
    err.className = "lane-error";
    err.textContent = `This lane failed: ${lane.error}`;
    el.append(err);
    return el;
  }

  el.append(renderStrip(lane, state.selected));
  return el;
}

/** The SVG strip: one shaded rect per sentence, plus a marker if it has labels. */
function renderStrip(lane: LaneModel, selected: number | undefined): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "strip");
  svg.setAttribute("viewBox", `0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "list");
  svg.setAttribute("aria-label", `${lane.name} by sentence`);

  for (const cell of lane.cells) {
    const g = document.createElementNS(SVG_NS, "g");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", cell.sentence === selected ? "cell selected" : "cell");
    rect.setAttribute("data-sentence", String(cell.sentence));
    rect.setAttribute("x", String(cell.x * STRIP_WIDTH));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(cell.width * STRIP_WIDTH));
    rect.setAttribute("height", String(STRIP_HEIGHT));
    // A faint floor (0.06) so empty cells are still visible and clickable.
    rect.setAttribute("fill-opacity", String(0.06 + 0.84 * cell.score));
    rect.setAttribute("role", "listitem");

    // Native tooltip: sentence number, labels and notes.
    const title = document.createElementNS(SVG_NS, "title");
    const notes = cell.spans.map((s) => s.note ?? s.label);
    title.textContent = `Sentence ${cell.sentence + 1}\n${notes.join("\n")}`;
    rect.append(title);
    g.append(rect);

    // Marker along the bottom when the sentence has unscored labels.
    if (cell.labels.length) {
      const marker = document.createElementNS(SVG_NS, "rect");
      marker.setAttribute("class", "marker");
      marker.setAttribute("x", String(cell.x * STRIP_WIDTH));
      marker.setAttribute("y", String(STRIP_HEIGHT - MARKER_HEIGHT));
      marker.setAttribute("width", String(cell.width * STRIP_WIDTH));
      marker.setAttribute("height", String(MARKER_HEIGHT));
      marker.setAttribute("pointer-events", "none");
      g.append(marker);
    }
    svg.append(g);
  }
  return svg;
}
