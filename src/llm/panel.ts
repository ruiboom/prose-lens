/**
 * panel.ts — the "Analyse with Claude" controls.
 *
 * A password field for the API key, a button and a status line.
 *
 * Key handling: the key lives only in the input element's value, in memory.
 * It is never written to localStorage, sessionStorage, cookies or the URL,
 * and it's gone when the tab closes.
 */
import type { Spine } from "../spine";
import type { LlmLane } from "../analysers/llm";
import type { ClaudeClient } from "./client";
import { buildPrompt } from "./prompt";
import { parseReadings } from "./parse";

export interface PanelOptions {
  lane: LlmLane;
  /** The current text's spine (read at click time). */
  getSpine(): Spine;
  /** Called after new readings are stored, so the app can redraw. */
  onUpdate(): void;
  /** Build a client for a key (injected so tests can fake it). */
  makeClient(apiKey: string): ClaudeClient;
}

export function createLlmPanel({ lane, getSpine, onUpdate, makeClient }: PanelOptions): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "llm-panel";

  const label = document.createElement("label");
  label.className = "llm-label";
  label.textContent = "Claude API key";

  const key = document.createElement("input");
  key.className = "llm-key";
  key.type = "password";
  key.autocomplete = "off";
  key.spellcheck = false;
  key.placeholder = "sk-ant-…";
  label.append(key);

  const button = document.createElement("button");
  button.className = "llm-run";
  button.type = "button";
  button.textContent = "Analyse with Claude";

  const status = document.createElement("p");
  status.className = "llm-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Sends the text to Claude with your key. The key stays in this tab only.";

  panel.append(label, button, status);

  button.addEventListener("click", async () => {
    const apiKey = key.value.trim();
    const spine = getSpine();
    if (!apiKey) {
      status.textContent = "Enter your Claude API key first.";
      return;
    }
    if (spine.sentences.length === 0) {
      status.textContent = "Nothing to analyse yet.";
      return;
    }

    button.disabled = true;
    status.textContent = `Analysing ${spine.sentences.length} sentences…`;
    try {
      const { system, user } = buildPrompt(spine);
      const reply = await makeClient(apiKey).complete(system, user);
      const result = parseReadings(reply, spine.sentences.length);
      if (result.error) {
        status.textContent = `${result.error}. Try again.`;
        return;
      }
      lane.setReadings(spine, result.readings);
      onUpdate();
      const dropped = result.dropped ? ` (${result.dropped} invalid reading${result.dropped > 1 ? "s" : ""} dropped)` : "";
      status.textContent = `Read ${result.readings.length} sentences${dropped}. Edited sentences lose their reading; run again to refresh.`;
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}
