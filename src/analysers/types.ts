/**
 * types.ts — the shapes every analyser shares.
 *
 * Every analyser, however it works inside, returns the same thing: a list
 * of spans. A span is a labelled stretch of the text in character offsets.
 * Because the output shape never changes, the lanes UI can draw any
 * analyser without knowing what it measures (like a plug-in on a mixing desk).
 */
import type { Spine } from "../spine";

/** One labelled stretch of the text. `end` is exclusive. */
export interface Span {
  start: number;
  end: number;
  /** The id of the analyser (lane) that produced this span. */
  layer: string;
  /** What was found, e.g. "passive", "latinate", "long-sentence". */
  label: string;
  /** Optional strength from 0 (weak) to 1 (strong); drives lane shading. */
  score?: number;
  /** Optional human explanation shown on hover: why this label was given. */
  note?: string;
}

/** A lane's analysis step. Implementations must pass `tests/contract.ts`. */
export interface Analyser {
  /** Lower-case slug, unique across the registry; also each span's `layer`. */
  id: string;
  /** Display name for the lane header. */
  name: string;
  /** One sentence on what the lane measures. */
  description: string;
  /** Analyse the text. Must be pure: same spine in, same spans out. */
  analyse(spine: Spine): Span[];
}
