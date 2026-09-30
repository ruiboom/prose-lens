/**
 * M1 + M6 — App shell and linked selection, end to end in jsdom.
 *
 * Typing re-runs the analysis (after a short debounce); clicking a lane cell
 * selects that sentence everywhere: every lane, the detail panel and the editor.
 */
import { defaultRegistry, mountApp } from "../src/app";
import { createRegistry } from "../src/analysers/registry";

/** Mount the app, type `text`, and let the debounce fire. */
function mountWith(text: string) {
  vi.useFakeTimers();
  const root = document.createElement("div");
  document.body.append(root);
  mountApp(root);
  const editor = root.querySelector<HTMLTextAreaElement>("textarea.editor")!;
  editor.value = text;
  editor.dispatchEvent(new Event("input"));
  vi.runAllTimers();
  vi.useRealTimers();
  return { root, editor };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountApp", () => {
  it("renders an editor and an empty lanes panel into the root", () => {
    const root = document.createElement("div");
    mountApp(root);

    expect(root.querySelector("textarea.editor")).not.toBeNull();
    const lanes = root.querySelector(".lanes");
    expect(lanes).not.toBeNull();
    expect(lanes!.querySelectorAll(".lane")).toHaveLength(0);
  });

  it("draws every instant lane after typing", () => {
    const { root } = mountWith("The ball was kicked. Go home.");
    const lanes = [...root.querySelectorAll<HTMLElement>(".lane")];
    expect(lanes.map((l) => l.dataset.lane)).toEqual(["syntax", "diction", "argument", "references"]);
    expect(lanes[0]!.querySelectorAll(".cell")).toHaveLength(2);
  });

  it("clicking a cell selects that sentence in every lane and the editor", () => {
    const { root, editor } = mountWith("The ball was kicked. Go home.");
    root.querySelector('.lane[data-lane="diction"] .cell[data-sentence="1"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    for (const lane of root.querySelectorAll(".lane")) {
      expect(lane.querySelector('.cell[data-sentence="1"]')!.classList.contains("selected")).toBe(true);
    }
    expect(editor.selectionStart).toBe(21);
    expect(editor.selectionEnd).toBe(29);
  });

  it("the detail panel shows the selected sentence and each lane's reading", () => {
    const { root } = mountWith("The ball was kicked. Go home.");
    root.querySelector('.cell[data-sentence="0"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const detail = root.querySelector(".detail")!;
    expect(detail.querySelector(".detail-sentence")!.textContent).toBe("The ball was kicked.");
    expect(detail.textContent).toMatch(/passive/i);
    // The passive phrase is highlighted inside the sentence.
    expect(detail.querySelector("mark.label-passive")!.textContent).toBe("was kicked");
  });

  it("moving the caret in the editor selects the sentence under it", () => {
    const { root, editor } = mountWith("The ball was kicked. Go home.");
    editor.setSelectionRange(24, 24);
    editor.dispatchEvent(new Event("keyup"));
    expect(root.querySelector('.lane[data-lane="syntax"] .cell.selected')!.getAttribute("data-sentence")).toBe("1");
  });

  it("setRegistry swaps the lanes and re-analyses straight away", () => {
    const root = document.createElement("div");
    const app = mountApp(root, { initialText: "The ball was kicked." });
    expect(root.querySelectorAll(".lane")).toHaveLength(4);

    const extra = { id: "extra", name: "Extra", description: "An extra lane.", analyse: () => [] };
    app.setRegistry(createRegistry([...defaultRegistry().list(), extra]));
    expect([...root.querySelectorAll<HTMLElement>(".lane")].map((l) => l.dataset.lane)).toEqual([
      "syntax",
      "diction",
      "argument",
      "references",
      "extra",
    ]);
  });

  it("exposes the current spine, a refresh and the side panel for add-ons", () => {
    const root = document.createElement("div");
    let calls = 0;
    const counting = { id: "count", name: "Count", description: "Counts runs.", analyse: () => (calls++, []) };
    const app = mountApp(root, { initialText: "One. Two.", registry: createRegistry([counting]) });

    expect(app.getSpine().sentences).toHaveLength(2);
    app.refresh();
    expect(calls).toBe(2);
    expect(root.contains(app.side)).toBe(true);
  });

  it("toggling a lane's checkbox hides and shows it", () => {
    const { root } = mountWith("The ball was kicked.");
    const toggle = () =>
      root.querySelector<HTMLInputElement>('.lane[data-lane="diction"] input[type="checkbox"]')!.click();

    toggle();
    expect(root.querySelector('.lane[data-lane="diction"]')!.classList.contains("hidden")).toBe(true);
    toggle();
    expect(root.querySelector('.lane[data-lane="diction"]')!.classList.contains("hidden")).toBe(false);
  });
});
