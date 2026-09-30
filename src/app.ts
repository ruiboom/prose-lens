/**
 * app.ts — the application shell.
 *
 * Layout: an editor (a plain <textarea>) on the left; on the right, the
 * lanes panel with the detail panel under it.
 *
 * Data flow (one direction, like a mixing desk's signal chain):
 *   editor text → spine → registry.runAll → lane model → lanes + detail
 *
 * Linked selection closes the loop:
 *   click a lane cell  → select that sentence everywhere + select it in the editor
 *   move the caret     → select the sentence under the caret
 */
import { buildSpine, sentenceAt, type Spine } from "./spine";
import { createRegistry, type Registry } from "./analysers/registry";
import type { Analyser } from "./analysers/types";
import { syntaxAnalyser } from "./analysers/syntax";
import { dictionAnalyser } from "./analysers/diction";
import { argumentAnalyser } from "./analysers/argument";
import { referencesAnalyser } from "./analysers/references";
import { buildLaneModel, renderLanes, type LaneModel } from "./lanes";
import { renderDetail } from "./detail";

export interface AppOptions {
  /** Analysers to run. Defaults to every built-in lane. */
  registry?: Registry;
  /** Text to load (and analyse immediately) on mount. */
  initialText?: string;
  /** Wait this long after the last keystroke before re-analysing. */
  debounceMs?: number;
}

/** Controls returned by mountApp. */
export interface AppHandle {
  /** Replace the analysers (e.g. once a lazy-loaded lane is ready) and re-analyse. */
  setRegistry(registry: Registry): void;
  /** The spine of the text as last analysed. */
  getSpine(): Spine;
  /** Re-run every analyser now (e.g. after the Claude lane gets new readings). */
  refresh(): void;
  /** The right-hand column, for add-on panels such as the Claude controls. */
  side: HTMLElement;
}

/** Lanes that aren't always there: Prosody loads late, Claude is opt-in. */
export interface OptionalLanes {
  prosody?: Analyser;
  llm?: Analyser;
}

/**
 * Build the registry in the fixed lane order:
 * Syntax, Diction, [Prosody], Argument, [Claude], References.
 * Claude sits under Argument so the two readings of the argument can be compared.
 */
export function buildRegistry({ prosody, llm }: OptionalLanes): Registry {
  return createRegistry([
    syntaxAnalyser,
    dictionAnalyser,
    ...(prosody ? [prosody] : []),
    argumentAnalyser,
    ...(llm ? [llm] : []),
    referencesAnalyser,
  ]);
}

/** The built-in lanes that load instantly, in display order. */
export const defaultRegistry = (): Registry => buildRegistry({});

/** Mount the app into `root`, replacing anything already there. */
export function mountApp(root: HTMLElement, options: AppOptions = {}): AppHandle {
  let registry = options.registry ?? defaultRegistry();
  const debounceMs = options.debounceMs ?? 250;

  // ---- DOM -------------------------------------------------------------
  root.innerHTML = "";
  const editor = document.createElement("textarea");
  editor.className = "editor";
  editor.placeholder = "Paste or type some prose…";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Text to analyse");

  const side = document.createElement("div");
  side.className = "side";
  const lanesEl = document.createElement("div");
  lanesEl.className = "lanes";
  const detailEl = document.createElement("div");
  detailEl.className = "detail";
  detailEl.setAttribute("aria-live", "polite");
  side.append(lanesEl, detailEl);
  root.append(editor, side);

  // ---- State -----------------------------------------------------------
  let spine: Spine = buildSpine("");
  let model: LaneModel[] = [];
  let selected: number | undefined;
  const hidden = new Set<string>();

  /** Redraw lanes and detail from the current state. */
  const render = () => {
    if (spine.sentences.length === 0) {
      lanesEl.replaceChildren();
      detailEl.replaceChildren();
      return;
    }
    renderLanes(lanesEl, model, { selected, hidden });
    renderDetail(detailEl, spine, model, selected);
  };

  /** Re-run every analyser over the editor's text. */
  const analyse = () => {
    spine = buildSpine(editor.value);
    model = buildLaneModel(spine, registry.runAll(spine), registry.list());
    // Keep the selection meaningful: follow the caret if the user is typing,
    // otherwise drop it if the sentence no longer exists.
    if (document.activeElement === editor) selected = sentenceAt(spine, editor.selectionStart)?.index;
    else if (selected !== undefined && selected >= spine.sentences.length) selected = undefined;
    render();
  };

  /** Select a sentence everywhere. */
  const select = (index: number | undefined) => {
    selected = index;
    render();
  };

  // ---- Events ----------------------------------------------------------
  let timer: ReturnType<typeof setTimeout> | undefined;
  editor.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(analyse, debounceMs);
  });

  // Caret moves (keys or clicks) select the sentence under the caret.
  const followCaret = () => {
    const index = sentenceAt(spine, editor.selectionStart)?.index;
    if (index !== selected) select(index);
  };
  editor.addEventListener("keyup", followCaret);
  editor.addEventListener("mouseup", followCaret);

  // One listener for every cell in every lane (event delegation).
  lanesEl.addEventListener("click", (e) => {
    const cell = (e.target as Element).closest?.(".cell");
    if (!cell) return;
    const index = Number(cell.getAttribute("data-sentence"));
    const sentence = spine.sentences[index];
    if (!sentence) return;
    select(index);
    // Show the sentence in the editor too.
    editor.focus();
    editor.setSelectionRange(sentence.start, sentence.end);
  });

  // Lane show/hide checkboxes.
  lanesEl.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.dataset.lane;
    if (!id) return;
    if (box.checked) hidden.delete(id);
    else hidden.add(id);
    render();
  });

  if (options.initialText) {
    editor.value = options.initialText;
    analyse();
  }

  return {
    setRegistry(next) {
      registry = next;
      analyse();
    },
    getSpine: () => spine,
    refresh: analyse,
    side,
  };
}
