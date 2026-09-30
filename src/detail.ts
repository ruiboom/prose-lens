/**
 * detail.ts — the detail panel for the selected sentence.
 *
 * Shows the sentence with every unscored span highlighted (<mark>), then
 * each lane's reading of it as a short list of notes. This is where
 * "click a sentence, every lane shows its reading" becomes readable.
 */
import type { Spine } from "./spine";
import type { LaneModel } from "./lanes";
import type { Span } from "./analysers/types";

/** Draw the detail panel for sentence `selected` (or a hint if none). */
export function renderDetail(
  container: HTMLElement,
  spine: Spine,
  model: LaneModel[],
  selected: number | undefined,
): void {
  const sentence = selected === undefined ? undefined : spine.sentences[selected];
  if (!sentence) {
    const hint = document.createElement("p");
    hint.className = "detail-hint";
    hint.textContent = "Click a sentence in the text or a cell in any lane to see every lane's reading of it.";
    container.replaceChildren(hint);
    return;
  }

  const heading = document.createElement("h2");
  heading.textContent = `Sentence ${sentence.index + 1}`;

  // All unscored spans from every lane, clipped to this sentence, for highlighting.
  const marks = model.flatMap((lane) => lane.cells[sentence.index]?.spans ?? []).filter((s) => s.score === undefined);
  const text = document.createElement("p");
  text.className = "detail-sentence";
  text.append(...highlight(spine.text, sentence.start, sentence.end, marks));

  const readings = document.createElement("dl");
  readings.className = "detail-readings";
  for (const lane of model) {
    const cell = lane.cells[sentence.index];
    const dt = document.createElement("dt");
    dt.textContent = lane.name;
    const dd = document.createElement("dd");
    if (lane.error !== undefined) {
      dd.textContent = `Failed: ${lane.error}`;
    } else if (!cell || cell.spans.length === 0) {
      dd.textContent = "Nothing flagged.";
    } else {
      const ul = document.createElement("ul");
      for (const span of cell.spans) {
        const li = document.createElement("li");
        li.className = `label-${span.label}`;
        li.textContent = span.note ? `${span.label}: ${span.note}` : span.label;
        ul.append(li);
      }
      dd.append(ul);
    }
    readings.append(dt, dd);
  }

  container.replaceChildren(heading, text, readings);
}

/**
 * Split text[start, end) into plain text nodes and <mark> elements.
 *
 * Spans may overlap (a cliché containing a Latinate word), so we cut the
 * sentence at every span boundary and give each piece the classes of all
 * spans covering it: <mark class="label-cliche label-latinate">.
 */
export function highlight(text: string, start: number, end: number, spans: Span[]): Node[] {
  const clipped = spans
    .map((s) => ({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) }))
    .filter((s) => s.start < s.end);

  // Every place a highlight begins or ends, plus the sentence edges.
  const cuts = [...new Set([start, end, ...clipped.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);

  const nodes: Node[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i]!, cuts[i + 1]!];
    const piece = text.slice(from, to);
    const covering = clipped.filter((s) => s.start <= from && s.end >= to);
    if (covering.length === 0) {
      nodes.push(document.createTextNode(piece));
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = [...new Set(covering.map((s) => `label-${s.label}`))].join(" ");
    mark.title = covering.map((s) => s.note ?? s.label).join("\n");
    mark.textContent = piece;
    nodes.push(mark);
  }
  return nodes;
}
